"""Offline tests: no Supabase/OpenAI accounts and no live sources required."""
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from api import core
from api.index import app,get_user
import api.index as api
import pytest

client=TestClient(app)
USER={'id':'11111111-1111-4111-8111-111111111111','email':'learner@example.com'}

@pytest.fixture(autouse=True)
def no_auth_override():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()

def signed_in():
    app.dependency_overrides[get_user]=lambda:USER

def test_public_config_no_secrets(monkeypatch):
    monkeypatch.delenv('SUPABASE_URL',raising=False)
    r=client.get('/api/config')
    assert r.status_code==200 and r.json()['configured'] is False
    assert 'SERVICE_ROLE' not in r.text

def test_private_endpoints_reject_anonymous():
    for url in ['/api/health','/api/state','/api/articles','/api/export']:
        assert client.get(url).status_code==401,url
    assert client.post('/api/state',json={'data':{'topics':{}},'expected_revision':0}).status_code==401

def test_protected_cron(monkeypatch):
    monkeypatch.setenv('CRON_SECRET','super-strong-secret-01234567')
    assert client.get('/api/cron/ingest').status_code==401
    assert client.get('/api/cron/ingest',headers={'Authorization':'Bearer incorrect'}).status_code==401

def test_study_state_revision_conflict(monkeypatch):
    signed_in()
    monkeypatch.setattr(core,'fetch_study_state',lambda uid:{'revision':7,'data':{'topics':{'T1':{'status':'done'}}}})
    assert client.get('/api/state').json()['revision']==7
    monkeypatch.setattr(core,'save_study_state',lambda uid,data,expected: None if expected!=7 else 8)
    assert client.post('/api/state',json={'data':{'topics':{}},'expected_revision':6}).status_code==409
    response=client.post('/api/state',json={'data':{'topics':{}},'expected_revision':7})
    assert response.status_code==200 and response.json()['revision']==8

def test_state_schema_validation():
    signed_in()
    assert client.post('/api/state',json={'data':{'notes':[]},'expected_revision':0}).status_code==422
    assert client.post('/api/state',json={'data':{'topics':{}},'expected_revision':-1}).status_code==422

def test_no_other_user_article(monkeypatch):
    signed_in()
    monkeypatch.setattr(core,'visible_article',lambda article_id,owner:None)
    article_id='77777777-7777-4777-8777-777777777777'
    assert client.get(f'/api/articles/{article_id}').status_code==404
    assert client.post(f'/api/articles/{article_id}/status',json={'status':'read'}).status_code==404
    assert client.get(f'/api/articles/{article_id}/file').status_code==404

def test_file_reject_non_pdf():
    signed_in()
    r=client.post('/api/upload',data={'published_date':'2026-11-03'},files={'file':('news.pdf',b'not a pdf','application/pdf')})
    assert r.status_code==422

def test_doc_requires_uuid_and_mime():
    signed_in()
    r=client.post('/api/documents/upload',data={'doc_id':'not-an-id'},files={'file':('x.pdf',b'xx','application/pdf')})
    assert r.status_code==422
    r=client.post('/api/documents/upload',data={'doc_id':'77777777-7777-4777-8777-777777777777'},files={'file':('x.svg',b'xx','image/svg+xml')})
    assert r.status_code==422

def test_article_listing_scopes_owner(monkeypatch):
    signed_in()
    calls=[]
    def rows(table,params=None,limit=300):
        calls.append((table,params))
        if table=='articles':
            return [{'id':'a','owner_id':None,'source':'PIB','title':'Government scheme','published_date':'2026-11-03','date_precision':'day','tags':['Polity'],'excerpt':'Brief','relevance':75},
                    {'id':'b','owner_id':USER['id'],'source':'PDF','title':'Uploaded magazine','published_date':'2026-10-01','date_precision':'day','tags':['Economy'],'excerpt':'Monthly','relevance':55}]
        return []
    monkeypatch.setattr(core,'rest_rows',rows)
    obj=client.get('/api/articles?source=PDF').json()
    assert len(obj['items'])==1 and obj['items'][0]['source']=='PDF'
    assert USER['id'] in calls[0][1]['or']

def test_pib_parser_validates_urls():
    sample='''<rss><channel><item><title>Sample govt news</title>
     <link>https://pib.gov.in/PressReleasePage.aspx?PRID=123</link>
     <pubDate>Mon, 02 Nov 2026 05:20:00 GMT</pubDate><description>A safe source</description></item>
     <item><title>Unsafe</title><link>https://evil.example/news</link><pubDate>Mon, 02 Nov 2026 05:20:00 GMT</pubDate></item>
     </channel></rss>'''
    arr=core.parse_pib(sample)
    assert len(arr)==1 and arr[0]['published_date']=='2026-11-02'

def test_prs_month_precision():
    html='<a href="/policy/monthly-policy-review/october-2026">Oct policy</a>'
    arr=core.parse_prs(html)
    assert len(arr)==1 and arr[0]['published_date']=='2026-10-01' and arr[0]['date_precision']=='month'

def test_signed_url_prefix(monkeypatch):
    monkeypatch.setattr(core,'backend',lambda *a,**kw:{'signedURL':'/object/sign/study-private/notes/a/file.pdf?token=x'})
    monkeypatch.setattr(core,'settings',lambda:('https://demo.supabase.co','pub','secret'))
    res=api.signed_download('notes/a/file.pdf')
    assert res['url']=='https://demo.supabase.co/storage/v1/object/sign/study-private/notes/a/file.pdf?token=x'


def test_pib_listing_official_markup():
    html = '''<html><ul class="num">
    <li><a href="/PressReleseDetail.aspx?PRID=2331238" title="Important government announcement on new programme">Important government announcement on new programme</a><span class="publishdatesmall">Posted on: 01 Nov 2026</span></li>
    <li><a href="/PressReleseDetail.aspx?PRID=2331239">Missing date must not import</a></li>
    <li><a href="https://not-official.example/PressReleseDetail.aspx?PRID=2331240">Malicious external item</a><span class="publishdatesmall">Posted on: 01 Nov 2026</span></li>
    </ul></html>'''
    rows=core.parse_pib_listing(html)
    assert len(rows)==1
    assert rows[0]['published_date']=='2026-11-01'
    assert rows[0]['url'].startswith('https://www.pib.gov.in/PressReleseDetail.aspx?PRID=2331238')

def test_pib_listing_requires_official_date():
    import pytest
    with pytest.raises(ValueError):
        core.parse_pib_listing('<ul><li><a href="/PressReleseDetail.aspx?PRID=1234">Some published release without date</a></li></ul>')


def test_prs_highlights_extracts_individual_dated_issue_entries():
    html='''<h1>October 2026</h1><span><strong>Highlights of this Issue</strong></span>
    <a href="#key-one"><strong>Cabinet approves a scheme for green industry (p. 4)</strong></a>
    <p><strong>Cabinet approves a scheme for green industry (p. 4)</strong></p>
    <a href="#key-two"><strong>GST_Council_recommends"> GST Council recommends several changes (p. 2)</strong></a>'''
    rows=core.parse_prs_highlights(
       html,'https://prsindia.org/policy/monthly-policy-review/october-2026','2026-10')
    assert len(rows)==2
    assert rows[0]['date_precision']=='month' and rows[0]['published_date']=='2026-10-01'
    assert rows[1]['title']=='PRS: GST Council recommends several changes'
    assert all(x['url']=='https://prsindia.org/policy/monthly-policy-review/october-2026' for x in rows)

def test_prs_highlights_rejects_external_report():
    import pytest
    with pytest.raises(ValueError):
        core.parse_prs_highlights('Highlights of this Issue','https://example.com/report','2026-10')


def test_study_guidance_source_metadata_only():
    from api.study_engine import study_guidance
    a={'title':'New RBI monetary policy initiative','source':'PIB','tags':['Economy'],
       'relevance':83,'excerpt':'Short official preview.'}
    g=study_guidance(a)
    assert g['rule_based'] and g['priority']=='high'
    assert any('Economic' in x for x in g['syllabus_links'])
    assert len(g['recall_questions'])>=2
    assert 'study_guidance' in core.flatten_article(a)

def test_study_guidance_demotes_ceremonies():
    from api.study_engine import study_guidance
    g=study_guidance({'title':'Minister congratulates award winners','tags':['Polity'],
                      'relevance':88,'excerpt':''})
    assert g['priority']!='high'


def test_first_read_schedules_tomorrows_recall(monkeypatch):
    from datetime import date, timedelta
    signed_in()
    monkeypatch.setattr(core,'visible_article',
        lambda article_id,user_id:{'id':article_id,'owner_id':None,
          'source':'PIB','title':'RBI policy','tags':['Economy'],
          'relevance':75,'excerpt':'Official note'})
    monkeypatch.setattr(core,'rest_rows',lambda *args,**kwargs:[])
    writes=[]
    def capture_write(table,rows,**kwargs):
        writes.append((table,rows))
        return rows
    monkeypatch.setattr(core,'rest_write',capture_write)
    article_id='77777777-7777-4777-8777-777777777777'
    response=client.post('/api/articles/'+article_id+'/status',json={'status':'read'})
    assert response.status_code==200
    assert writes[0][0]=='article_progress'
    assert writes[0][1][0]['revision_due']==(date.today()+timedelta(days=1)).isoformat()


def test_gemini_json_response_and_mcq_validation():
    import json
    from api import gemini_client
    example={'summary':'This verified source discusses a public policy change.',
        'key_facts':['Fact from source'],'static_links':['Indian Economy'],
        'why_relevant':'Relevant to the UPSC Economy syllabus.',
        'uncertainties':[],
        'mcqs':[{'question':'Which syllabus subject applies?',
                 'options':['Economy','History','Environment','Art'],
                 'answer_index':0,'explanation':'The source describes economic policy.'}]}
    data={'candidates':[{'content':{'parts':[{'text':json.dumps(example)}]}}]}
    assert gemini_client.parse_response(data)['mcqs'][0]['answer_index']==0
    example['mcqs'][0]['answer_index']=9
    data['candidates'][0]['content']['parts'][0]['text']=json.dumps(example)
    assert gemini_client.parse_response(data)['mcqs']==[]

def test_gemini_config_health(monkeypatch):
    signed_in()
    monkeypatch.setattr(core,'rest_rows',lambda *a,**kw:[])
    monkeypatch.setenv('GEMINI_API_KEY','demo-value')
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    response=client.get('/api/health')
    assert response.status_code==200
    assert response.json()['ai_enabled'] is True
    assert response.json()['ai_provider']=='Gemini'

def test_gemini_api_is_server_side(monkeypatch):
    import json
    from api import gemini_client
    monkeypatch.setenv('GEMINI_API_KEY','dummy-secret')
    monkeypatch.delenv('GEMINI_MODEL',raising=False)
    seen={}
    class Reply:
        status_code=200
        def json(self):
            obj={'summary':'The official source describes an important policy change.',
                 'key_facts':[],'static_links':[],'why_relevant':'Relevant',
                 'uncertainties':[],'mcqs':[]}
            return {'candidates':[{'content':{'parts':[{'text':json.dumps(obj)}]}}]}
    class Client:
        def __init__(self,*args,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):return False
        def post(self,url,headers,json):
            seen.update(url=url,headers=headers,body=json)
            return Reply()
    monkeypatch.setattr(gemini_client.httpx,'Client',Client)
    result=gemini_client.generate('https://pib.gov.in/example','2026-11-03',
                                  'Policy update','The official statement describes a policy.')
    assert result['provider']=='Gemini'
    assert seen['headers']['x-goog-api-key']=='dummy-secret'
    assert 'dummy-secret' not in seen['url']
    assert seen['body']['generationConfig']['responseMimeType']=='application/json'


def test_pib_source_extracts_only_matching_release_body():
    from api.source_text import parse_pib_article
    html = '''<main><div class="innner-page-main-about-us-content-right-part">
      <h1>RBI announces new banking policy changes</h1>
      <p>The regulator announced a detailed measure concerning bank liquidity requirements and
         statutory oversight provisions for eligible financial institutions in the country.</p>
      <p>These provisions include additional disclosure and supervisory controls for regulated
         banking institutions and detailed reporting measures for the policy changes.</p>
      <span>Release ID: 123456</span></div></main>'''
    text=parse_pib_article(html,'RBI announces new banking policy changes','123456')
    assert 'statutory oversight' in text
    assert 'Release ID: 123456' not in text or 'Verified release ID: 123456' in text
    with pytest.raises(ValueError):
        parse_pib_article(html,'Entirely unrelated school announcement','123456')

def test_prs_source_links_selected_highlight_to_own_paragraph():
    from api.source_text import parse_prs_article
    html='''<div class="view-policy-reviews"><div class="view-content">
      <p><strong>Repo rate increased to 5.5% (p. 2)</strong></p>
      <p>RBI committee increased the repo rate from 5.25 percent to 5.5 percent
         and revised other corridor policy rates accordingly.</p>
      <p><strong>GST Council recommends changes (p. 3)</strong></p>
      <p>The council recommended simpler registrations for small enterprises
         and a modified refund process for the tax administration.</p>
      </div></div>'''
    text=parse_prs_article(html,'PRS: Repo rate increased to 5.5%','2026-10')
    assert 'repo rate from 5.25 percent' in text
    assert 'refund process' not in text
    with pytest.raises(ValueError):
        parse_prs_article(html,'PRS: Unrelated international treaty','2026-10')

def test_source_host_and_release_id_are_verified():
    from api.source_text import fetch_verified_article
    with pytest.raises(ValueError):
        fetch_verified_article(
            {'source':'PIB','url':'https://evil.example/PressReleseDetail.aspx?PRID=123',
             'title':'Government announcement'}, lambda url:'unreachable')


def test_bulk_gemini_quota_endpoint_is_provider_limited_and_authenticated(monkeypatch):
    signed_in()
    monkeypatch.setenv('GEMINI_API_KEY','set-for-test')
    monkeypatch.setenv('DAILY_AI_LIMIT','10')  # legacy setting must not impose a cap
    monkeypatch.setattr(core,'rest_rows',lambda table,params,limit: [{'id':'used'}]*18
        if table=='ai_usage' else [])
    response=client.get('/api/ai/usage')
    assert response.status_code==200
    assert response.json()=={'used':18,'limit':None,'remaining':None,
                             'quota_source':'Gemini API','enabled':True}
    app.dependency_overrides.clear()
    assert client.get('/api/ai/usage').status_code==401

def test_current_affairs_batch_renders_progress_without_changing_card_order():
    from pathlib import Path
    script=(Path(__file__).resolve().parents[1]/'public'/'app.js').read_text(encoding='utf-8')
    assert 'data-ca-item=' in script and 'function caStableRender(' in script
    assert 'data-ca-bulk-start' in script
    assert 'data-ca-bulk-stop' in script
    assert 'data-ca-bulk-meter' in script
    assert "caRequest('/api/ai/usage')" in script
    assert 'caBulkPaint()' in script
    assert "caUI.busyId=null;if(page==='current')caStableRender(id)" in script
    assert 'await caLoad({renderAfter:false})' in script
    assert 'Syllabus Club has no artificial daily limit' in script
    assert 'Gemini API quota or rate limit reached' in script

def test_gemini_generation_not_blocked_by_legacy_cap(monkeypatch):
    signed_in()
    monkeypatch.setenv('GEMINI_API_KEY','test-only')
    monkeypatch.setenv('DAILY_AI_LIMIT','10')
    article_id='77777777-7777-4777-8777-777777777777'
    article={'id':article_id,'owner_id':None,'source':'PDF',
             'source_text':'Official public policy documentation contains verified facts and context. '*4,
             'title':'Official policy document','published_date':'2026-11-03',
             'date_precision':'day','tags':['Polity'],'relevance':60}
    monkeypatch.setattr(api,'article_or_404',lambda aid,uid:article)
    monkeypatch.setattr(core,'rest_rows',lambda table,params=None,limit=100: [{'id':str(i)} for i in range(18)]
                        if table=='ai_usage' else [])
    monkeypatch.setattr(core,'rest_update',lambda *args,**kwargs: [])
    monkeypatch.setattr(core,'rest_write',lambda *args,**kwargs: [])
    monkeypatch.setattr(api.gemini_client,'generate',
        lambda *args,**kwargs:{'summary':'A verified public policy summary.',
            'key_facts':[], 'static_links':[],'why_relevant':'Polity','uncertainties':[],
            'mcqs':[], 'provider':'Gemini','model':'test'})
    response=client.post('/api/articles/'+article_id+'/analyze')
    assert response.status_code==200
    assert response.json()['analysis']['provider']=='Gemini'
