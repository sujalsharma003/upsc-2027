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
