"""Syllabus Club V4 — Vercel FastAPI entrypoint, intentionally stateless."""
from __future__ import annotations
import io
import json
import os
import secrets
import uuid
from datetime import date,timedelta,datetime,timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
import fitz
import httpx
from fastapi import Depends,FastAPI,File,Form,Header,HTTPException,Request,UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel,Field
from . import core as c
from . import gemini_client
from . import source_text

app=FastAPI(title='Syllabus Club V4 API',docs_url=None,redoc_url=None,openapi_url=None)
MAX_PDF=4*1024*1024  # Keep below the Vercel request payload limit.

class StateUpdate(BaseModel):
    data:dict[str,Any]
    expected_revision:int=Field(ge=0)

class StatusUpdate(BaseModel):
    status:str


def get_user(authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(401,'Sign in to access your study data')
    user=c.authenticated_user(authorization[7:].strip())
    if user is None:raise HTTPException(401,'Session expired. Sign in again.')
    owner=os.getenv('OWNER_EMAIL','').strip().casefold()
    if not owner:raise HTTPException(503,'Set OWNER_EMAIL in Vercel to restrict access to your account')
    if (user.get('email') or '').casefold()!=owner:
        raise HTTPException(403,'This dashboard is restricted to the designated owner')
    return user

def hidden(exc:Exception):
    # Do not leak upstream responses, service-role secrets or private source text.
    return HTTPException(503,'Cloud service unavailable. Check configuration or try again.')

def article_or_404(article_id,user_id):
    article=c.visible_article(article_id,user_id)
    if article is None:raise HTTPException(404,'Source entry not found')
    return article

@app.get('/api/config')
def public_config():
    return c.public_config()

@app.get('/api/health')
def health(user=Depends(get_user)):
    try:
        last=c.rest_rows('ingestion_runs',{'order':'started_at.desc','select':'started_at,finished_at,items_added,errors'},1)
        return {'online':True,'ai_enabled':bool(os.getenv('GEMINI_API_KEY')),'ai_provider':'Gemini',
          'auto_sync':True,'auto_analyze':False,'rule_based_study_guides':True,'storage':'Supabase cloud',
          'last_sync':({ 'ran_at':last[0]['started_at'],'added':last[0]['items_added'],
                      'errors':last[0]['errors']} if last else None),
          'sources':{'PIB':c.PIB,'PRS':c.PRS},'tags':list(c.TAG_TERMS)}
    except RuntimeError as e:raise hidden(e)

def ai_quota_for_user(user_id:str):
    today=datetime.now(timezone.utc).date().isoformat()+'T00:00:00+00:00'
    limit=max(1,min(50,int(os.getenv('DAILY_AI_LIMIT','10'))))
    usage=c.rest_rows('ai_usage',{
        'user_id':f'eq.{user_id}','created_at':'gte.'+today,
        'select':'id'},100)
    used=len(usage)
    return {'used':used,'limit':limit,'remaining':max(0,limit-used)}


@app.get('/api/ai/usage')
def ai_usage(user=Depends(get_user)):
    try:
        return {**ai_quota_for_user(user['id']),
                'enabled':bool(os.getenv('GEMINI_API_KEY'))}
    except (RuntimeError,ValueError) as e:
        raise hidden(e)


@app.get('/api/state')
def state_get(user=Depends(get_user)):
    try:return c.fetch_study_state(user['id'])
    except RuntimeError as e:raise hidden(e)

@app.post('/api/state')
def state_save(body:StateUpdate,user=Depends(get_user)):
    # Exclude excessive payloads; snapshots consist of metadata & study logs, not PDF bytes.
    if len(json.dumps(body.data,ensure_ascii=False))>2_000_000:
        raise HTTPException(413,'State exceeds 2 MB. Export a backup and reduce oversized notes.')
    if 'topics' not in body.data or not isinstance(body.data.get('topics'),dict):
        raise HTTPException(422,'Invalid study snapshot')
    try:revision=c.save_study_state(user['id'],body.data,body.expected_revision)
    except RuntimeError as e:raise hidden(e)
    if revision is None:raise HTTPException(409,'Cloud data changed on another device. Refresh and resolve the conflict before saving.')
    return {'saved':True,'revision':revision}

@app.get('/api/articles')
def articles(source:str='all',tag:str='all',date_from:str='',date_to:str='',q:str='',limit:int=200,offset:int=0,user=Depends(get_user)):
    try:
        filters={'or':f'(owner_id.is.null,owner_id.eq.{user["id"]})',
             'order':'published_date.desc,added_at.desc',
             'select':'id,owner_id,source,url,title,published_date,date_precision,added_at,excerpt,tags,relevance,analysis,analyzed_at,file_name'}
        if source!='all':
            if source not in ('PIB','PRS','PDF'):raise HTTPException(422,'Unknown source filter')
            filters['source']='eq.'+source
        conditions=[]
        for value,op in ((date_from,'gte'),(date_to,'lte')):
            if value:
                try:conditions.append('published_date.'+op+'.'+date.fromisoformat(value).isoformat())
                except ValueError:raise HTTPException(422,'Invalid publication date filter')
        if conditions: filters['and']='('+','.join(conditions)+')'
        if offset<0 or offset>10000:raise HTTPException(422,'Invalid article pagination offset')
        filters['offset']=str(offset)
        rows=c.rest_rows('articles',filters,400)
        progress={p['article_id']:p for p in c.progress_rows(user['id'])}
    except RuntimeError as e:raise hidden(e)
    visible=[]
    for row in rows:
        if source!='all' and row['source']!=source:continue
        if tag!='all' and tag not in (row['tags'] or []):continue
        if date_from and row['published_date']<date_from:continue
        if date_to and row['published_date']>date_to:continue
        if q and q.lower() not in (row['title']+' '+row.get('excerpt','')).lower():continue
        visible.append(c.flatten_article(row,progress.get(row['id'])))
        if len(visible)>=max(1,min(limit,300)):break
    return {'items':visible}

@app.get('/api/articles/{article_id}')
def article(article_id:str,user=Depends(get_user)):
    try:
        row=article_or_404(article_id,user['id'])
        prs=c.rest_rows('article_progress',{'user_id':f'eq.{user["id"]}','article_id':f'eq.{article_id}'},1)
        return c.flatten_article(row,prs[0] if prs else None)
    except RuntimeError as e:raise hidden(e)

@app.post('/api/articles/{article_id}/status')
def article_status(article_id:str,body:StatusUpdate,user=Depends(get_user)):
    if body.status not in ('unread','read','saved'):raise HTTPException(422,'Unknown reading status')
    try:
        row=article_or_404(article_id,user['id'])
        existing=c.rest_rows('article_progress',{'user_id':f'eq.{user["id"]}',
             'article_id':f'eq.{article_id}'},1)
        previous=existing[0] if existing else {}
        # First read schedules an active-recall check; preserve an existing plan.
        first_due=(date.today()+timedelta(days=1)).isoformat() if body.status=='read' and not previous.get('revision_due') else previous.get('revision_due')
        p=c.rest_write('article_progress',[{'user_id':user['id'],'article_id':article_id,
            'read_status':body.status,'revision_stage':previous.get('revision_stage',0),
            'revision_due':first_due, 'updated_at':c.utcnow()}],
            on_conflict='user_id,article_id')
        return c.flatten_article(row,p[0] if p else {'read_status':body.status})
    except RuntimeError as e:raise hidden(e)

@app.post('/api/articles/{article_id}/revise')
def article_revise(article_id:str,user=Depends(get_user)):
    try:
        row=article_or_404(article_id,user['id'])
        existing=c.rest_rows('article_progress',{'user_id':f'eq.{user["id"]}','article_id':f'eq.{article_id}'},1)
        stage=min(5,(existing[0].get('revision_stage') if existing else 0)+1)
        offset=[0,1,7,21,45,60][stage]
        due=(date.today()+timedelta(days=offset)).isoformat()
        p=c.rest_write('article_progress',[{'user_id':user['id'],'article_id':article_id,
            'read_status':'read','revision_stage':stage,'revision_due':due,
            'updated_at':c.utcnow()}],on_conflict='user_id,article_id')
        return c.flatten_article(row,p[0] if p else {'revision_stage':stage,'revision_due':due,'read_status':'read'})
    except RuntimeError as e:raise hidden(e)

@app.post('/api/upload')
async def upload(file:UploadFile=File(...),published_date:str=Form(...),user=Depends(get_user)):
    try:date.fromisoformat(published_date)
    except ValueError:raise HTTPException(422,'Issue date must be YYYY-MM-DD')
    blob=await file.read(MAX_PDF+1)
    if len(blob)>MAX_PDF:raise HTTPException(413,'Maximum hosted PDF size is 4 MB')
    if not blob.startswith(b'%PDF-'):raise HTTPException(422,'The uploaded file is not a valid PDF')
    try:
        pdf=fitz.open(stream=blob,filetype='pdf')
        if pdf.needs_pass:raise ValueError('Password-protected PDFs are not supported')
        if pdf.page_count>120:raise ValueError('Use a PDF with 120 pages or fewer')
        raw=' '.join(page.get_text() for page in pdf)
        pdf.close()
    except (RuntimeError,ValueError) as e:raise HTTPException(422,str(e))
    extracted=' '.join(raw.split())[:40000]
    doc_id=str(uuid.uuid4())
    file_name=Path(file.filename or 'uploaded.pdf').name[:150]
    path=f'pdf/{user["id"]}/{doc_id}.pdf'
    tags,rank=c.classify(file_name,extracted)
    row=c.as_article({'source':'PDF','title':file_name,'published_date':published_date,
        'source_text':extracted,'date_precision':'day'},owner_id=user['id'])
    row.update({'id':doc_id,'file_name':file_name,'file_path':path,
        'content_hash':__import__('hashlib').sha256((user['id']+'-'+doc_id).encode()).hexdigest(),
        'tags':tags,'relevance':rank})
    try:
        c.backend('POST','/storage/v1/object/study-private/'+path,
          raw=blob,headers={'Content-Type':'application/pdf','x-upsert':'false'})
        try:c.rest_write('articles',[row])
        except RuntimeError:
            c.backend('DELETE','/storage/v1/object/study-private/'+path)
            raise
        return c.flatten_article(row)
    except RuntimeError as e:raise hidden(e)

def signed_download(path:str):
    if not path or path.startswith('/') or '..' in path.split('/'):
        raise HTTPException(404,'File unavailable')
    r=c.backend('POST','/storage/v1/object/sign/study-private/'+path,payload={'expiresIn':90})
    signed=r.get('signedURL') or r.get('signedUrl','')
    if not isinstance(signed,str) or not (signed.startswith('/storage/v1/object/sign/') or signed.startswith('/object/sign/')):
        raise HTTPException(503,'Cannot create private download link')
    url,_,_=c.settings()
    return {'url':url+(signed if signed.startswith('/storage/v1/') else '/storage/v1'+signed),'expires_in':90}

@app.get('/api/articles/{article_id}/file')
def article_file(article_id:str,user=Depends(get_user)):
    try:
        row=article_or_404(article_id,user['id'])
        if row['source']!='PDF' or row['owner_id']!=user['id']:
            raise HTTPException(404,'File unavailable')
        return signed_download(row['file_path'])
    except RuntimeError as e:raise hidden(e)

@app.post('/api/documents/upload')
async def document_upload(file:UploadFile=File(...),doc_id:str=Form(...),user=Depends(get_user)):
    try:uuid.UUID(doc_id)
    except ValueError:raise HTTPException(422,'Invalid document ID')
    blob=await file.read(MAX_PDF+1)
    if len(blob)>MAX_PDF:raise HTTPException(413,'Maximum hosted document size is 4 MB')
    type_ok={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','text/plain':'txt'}
    ext=type_ok.get(file.content_type or '')
    if not ext:raise HTTPException(422,'Only PDF, PNG, JPEG, and TXT are supported')
    if ext=='pdf' and not blob.startswith(b'%PDF-'):raise HTTPException(422,'Not a valid PDF')
    path=f'notes/{user["id"]}/{doc_id}.{ext}'
    try:
        c.backend('POST','/storage/v1/object/study-private/'+path,
          raw=blob,headers={'Content-Type':file.content_type,'x-upsert':'false'})
        try:c.rest_write('study_documents',[{'user_id':user['id'],'id':doc_id,
            'file_name':Path(file.filename or 'document').name[:180],
            'file_path':path,'media_type':file.content_type,'size_bytes':len(blob)}])
        except RuntimeError:
            c.backend('DELETE','/storage/v1/object/study-private/'+path)
            raise
        return {'ok':True,'id':doc_id,'name':file.filename,'size':len(blob)}
    except RuntimeError as e:raise hidden(e)

@app.get('/api/documents/{doc_id}/url')
def document_url(doc_id:str,user=Depends(get_user)):
    try:
        uuid.UUID(doc_id)
        rows=c.rest_rows('study_documents',{'user_id':f'eq.{user["id"]}','id':f'eq.{doc_id}'},1)
        if not rows:raise HTTPException(404,'Document unavailable')
        return signed_download(rows[0]['file_path'])
    except ValueError:raise HTTPException(404,'Invalid document')
    except RuntimeError as e:raise hidden(e)

@app.delete('/api/documents/{doc_id}')
def document_delete(doc_id:str,user=Depends(get_user)):
    try:
        uuid.UUID(doc_id)
        rows=c.rest_rows('study_documents',{'user_id':f'eq.{user["id"]}','id':f'eq.{doc_id}'},1)
        if not rows:raise HTTPException(404,'Document unavailable')
        path=rows[0]['file_path']
        c.backend('DELETE','/storage/v1/object/study-private/'+path)
        c.rest_delete('study_documents',{'user_id':f'eq.{user["id"]}','id':f'eq.{doc_id}'})
        return {'deleted':True}
    except ValueError:raise HTTPException(404,'Invalid document')
    except RuntimeError as e:raise hidden(e)

@app.get('/api/export')
def export(user=Depends(get_user)):
    rows=articles(user=user)['items']
    return {'app':'Syllabus Club Current Affairs','exported_at':c.utcnow(),
       'metadata_only':True,'pdf_files_included':False,'items':rows}

@app.post('/api/articles/{article_id}/analyze')
def analyze(article_id:str,user=Depends(get_user)):
    if not os.getenv('GEMINI_API_KEY'):
        raise HTTPException(503,'Add GEMINI_API_KEY in Vercel environment settings to enable AI notes')
    try:
        # Cost guard: cap requests per owner/day, even if a token is compromised.
        if ai_quota_for_user(user['id'])['remaining']<1:
            raise HTTPException(429,'Daily Gemini generation limit reached. Continue tomorrow.')
        row=article_or_404(article_id,user['id'])
        text=(row.get('source_text') or '')
        # Imported PIB/PRS rows may contain placeholder text. Always get
        # article-specific evidence, not a navigation page or unrelated PRS items.
        if row['source'] in ('PIB','PRS'):
            try:
                text=source_text.fetch_verified_article(row,c.safe_fetch)
            except source_text.MissingSourceText as exc:
                raise HTTPException(422,str(exc)) from exc
            except httpx.HTTPError as exc:
                raise HTTPException(422,'Official source could not be retrieved; try again later') from exc
            # Cache verified public source material only. The original source
            # title/date/URL remain untouched; no fabricated facts are stored.
            if text!=row.get('source_text'):
                c.rest_update('articles',{'source_text':text,'excerpt':text[:500]},
                              {'id':f"eq.{row['id']}"})
                row['source_text']=text
                row['excerpt']=text[:500]
        if len(text.strip())<100:
            raise HTTPException(422,'Not enough verified text in this source to generate notes')
        obj=gemini_client.generate(
            str(row.get('url') or row.get('file_name') or ''),
            row['published_date'],row['title'],text)
        c.rest_update('articles',{'analysis':obj,'analyzed_at':c.utcnow()},
             {'id':f'eq.{article_id}'})
        c.rest_write('ai_usage',[{'user_id':user['id'],'article_id':article_id}])
        row['analysis']=obj
        return c.flatten_article(row)
    except HTTPException:raise
    except gemini_client.GeminiError as e:
        raise HTTPException(502,str(e)) from e
    except (RuntimeError,ValueError,KeyError,httpx.HTTPError,IndexError) as e:
        raise HTTPException(502,'Unable to generate notes. Check the source and AI configuration.')

@app.post('/api/refresh')
def refresh(user=Depends(get_user)):
    return run_ingestion(manual=True)

@app.get('/api/cron/ingest')
def cron_ingest(authorization:str|None=Header(default=None)):
    secret=os.getenv('CRON_SECRET')
    if not secret or len(secret)<16 or not authorization or not secrets.compare_digest(
        authorization, 'Bearer '+secret):
        raise HTTPException(401,'Unauthorized')
    return run_ingestion(manual=False)

def run_ingestion(manual:bool):
    try:
        last=c.rest_rows('ingestion_runs',{'order':'started_at.desc','select':'started_at,errors'},1)
        if last:
            age=(datetime.now(timezone.utc)-datetime.fromisoformat(last[0]['started_at'].replace('Z','+00:00'))).total_seconds()
            # Let the owner retry a failed upstream feed after 5 minutes rather than
            # locking the broken source out for the normal 2-hour refresh interval.
            previous_errors=last[0].get('errors') or []
            interval=300 if manual and previous_errors else (7200 if manual else 3600)
            if age<interval:
                return {'ran_at':last[0]['started_at'],'added':0,'errors':previous_errors,
                    'skipped':True,'message':'Sources were checked recently'}
        result=c.ingest_public_sources()
        c.rest_write('ingestion_runs',[{'id':str(uuid.uuid4()),'started_at':result['ran_at'],
            'finished_at':c.utcnow(),'items_added':result['added'],'errors':result['errors']}])
        return result
    except RuntimeError as e: raise hidden(e)

@app.get('/')
def api_root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse('/index.html',status_code=307)








