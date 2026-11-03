"""V4 cloud storage / official source helpers. No writable local disk required."""
from __future__ import annotations
import hashlib
import os
import re
import secrets
import uuid
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse
import httpx
from bs4 import BeautifulSoup

PIB = 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1'
# PIB publishes multiple official English feed listings; try a second one only if the first fails.
PIB_ALTERNATE = 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'
PRS = 'https://prsindia.org/policy/monthly-policy-review'
ALLOWED = {'pib.gov.in', 'www.pib.gov.in', 'prsindia.org', 'www.prsindia.org'}
TAG_TERMS = {
 'Polity':['constitution','parliament','legislative','governance','bill','act','judiciary','supreme court','election','rights','commission'],
 'Economy':['rbi','inflation','monetary','fiscal','budget','trade','tax','gst','bank','gdp','agriculture','farmer','finance'],
 'Environment':['climate','biodiversity','species','forest','pollution','environment','wetland','conservation','carbon','emissions','solar'],
 'Geography':['river','island','cyclone','mountain','monsoon','disaster','ocean','earthquake','border'],
 'Science & Tech':['isro','satellite','launch','space','vaccine','nuclear','cyber','robot','semiconductor','biotech','genome','science'],
 'International Relations':['bilateral','global','summit','international','foreign','asean','brics','treaty','diplomatic'],
 'History & Culture':['heritage','culture','museum','ancient','historical','archaeology','unesco'],
 'Social Issues':['nutrition','education','poverty','health','women','child','welfare','social','census']
}

def settings():
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    # Prefer current Supabase publishable/secret keys, while retaining legacy compatibility.
    anon = os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('SUPABASE_ANON_KEY', '')
    service = os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not (url.startswith('https://') and '.supabase.co' in url and anon and service):
        raise RuntimeError('Supabase server environment variables are missing')
    return url, anon, service

def public_config():
    try:
        url, anon, _ = settings()
        return {'configured':True, 'supabase_url':url, 'supabase_anon_key':anon}
    except RuntimeError:
        return {'configured':False, 'supabase_url':'', 'supabase_anon_key':''}

def backend(method, path, *, params=None, payload=None, raw=None, headers=None, timeout=20):
    url, _, key = settings()
    # New sb_secret keys are opaque API keys, not JWTs: never send them as Bearer tokens.
    # Legacy service_role keys are JWTs and may be used in both headers.
    h = {'apikey':key}
    if not key.startswith('sb_secret_'):
        h['Authorization'] = f'Bearer {key}'
    if payload is not None:
        h['Content-Type'] = 'application/json'
    if headers: h.update(headers)
    with httpx.Client(timeout=timeout,follow_redirects=False) as client:
        response = client.request(method,url+path,params=params,json=payload,content=raw,headers=h)
    if response.status_code >= 400:
        # Avoid surfacing credentials or internal upstream error bodies.
        raise RuntimeError(f'Database/storage request failed (HTTP {response.status_code})')
    if not response.content:return None
    ctype=response.headers.get('content-type','')
    return response.json() if 'json' in ctype else response.content

def authenticated_user(token):
    if not token or not re.fullmatch(r'[A-Za-z0-9._~+\-/=]+', token) or len(token)>8192:
        return None
    try:
        url, anon, _ = settings()
        with httpx.Client(timeout=8,follow_redirects=False) as client:
            res=client.get(url+'/auth/v1/user',headers={'apikey':anon,'Authorization':f'Bearer {token}'})
        if res.status_code!=200:return None
        user=res.json()
        uuid.UUID(user['id'])
        return {'id':user['id'],'email':user.get('email','')}
    except (KeyError,ValueError,RuntimeError,httpx.HTTPError):return None

def rest_rows(table,params=None,limit=300):
    d=dict(params or {})
    d.setdefault('select','*')
    d.setdefault('limit',str(limit))
    return backend('GET',f'/rest/v1/{table}',params=d) or []

def rest_write(table,rows, *, on_conflict=None, ignore_duplicates=False):
    prefs=['return=representation']
    if on_conflict:prefs.append('resolution=' + ('ignore-duplicates' if ignore_duplicates else 'merge-duplicates'))
    p={'on_conflict':on_conflict} if on_conflict else None
    return backend('POST',f'/rest/v1/{table}',params=p,payload=rows,headers={'Prefer':','.join(prefs)}) or []

def rest_update(table, payload, params):
    return backend('PATCH',f'/rest/v1/{table}',params=params,payload=payload,headers={'Prefer':'return=representation'}) or []

def rest_delete(table, params):
    return backend('DELETE',f'/rest/v1/{table}',params=params,headers={'Prefer':'return=representation'}) or []

def fetch_study_state(user_id):
    rows=rest_rows('study_state',{'user_id':f'eq.{user_id}','select':'payload,revision,updated_at'},1)
    if not rows:return {'data':None,'revision':0}
    return {'data':rows[0]['payload'],'revision':int(rows[0]['revision']),'updated_at':rows[0]['updated_at']}

def save_study_state(user_id, payload, expected_revision):
    # One transaction in Postgres, atomic compare-and-set across devices.
    res=backend('POST','/rest/v1/rpc/save_study_state',payload={
        'p_user_id':user_id,'p_payload':payload,'p_expected_revision':expected_revision})
    return int(res) if res is not None else None

def visible_article(article_id,user_id):
    try: uuid.UUID(article_id)
    except ValueError:return None
    rows=rest_rows('articles',{'id':f'eq.{article_id}','select':'*'},1)
    if not rows:return None
    article=rows[0]
    return article if article['owner_id'] is None or article['owner_id']==user_id else None

def progress_rows(user_id):
    return rest_rows('article_progress',{'user_id':f'eq.{user_id}','select':'*'},2000)

def flatten_article(article, progress=None):
    progress=progress or {}
    return {**article,
      'tags':article.get('tags') or [],
      'read_status':progress.get('read_status','unread'),
      'revision_stage':progress.get('revision_stage',0),
      'revision_due':progress.get('revision_due')}

def utcnow():return datetime.now(timezone.utc).isoformat(timespec='seconds')

def classify(title,body=''):
    blob=(title+' '+(body or '')[:1500]).lower()
    weights=[]
    for label,terms in TAG_TERMS.items():
        pts=sum(3 if term in title.lower() else 1 for term in terms if term in blob)
        if pts:weights.append((pts,label))
    weights.sort(reverse=True)
    return [v for _,v in weights[:3]], min(95,25+9*weights[0][0]) if weights else 15

def safe_source(url):
    p=urlparse(url)
    return (p.scheme=='https' and p.hostname in ALLOWED and p.port in (None,443)
       and not p.username and not p.password)

def safe_fetch(url):
    """Fetch an allowlisted official source through bounded, HTTPS-only redirects.

    PIB has been seen returning 301 to www.pib.gov.in followed by 302.
    Our previous single-hop fetch raised on the second redirect.
    """
    seen=set()
    current=url
    with httpx.Client(timeout=8,follow_redirects=False,headers={
      'User-Agent':'SyllabusClubStudyResearch/4.1 (personal noncommercial educational reader)',
      'Accept':'application/rss+xml, application/xml, text/xml, text/html;q=0.8'
    }) as c:
        for _ in range(6):
            if not safe_source(current):
                raise ValueError('External source or redirect is not allowlisted')
            if current in seen:
                raise ValueError('Official source redirect loop')
            seen.add(current)
            r=c.get(current)
            if 300 <= r.status_code < 400:
                location=r.headers.get('location')
                if not location:
                    raise ValueError(f'Official source returned redirect {r.status_code} without location')
                dest=urljoin(current,location)
                if not safe_source(dest):
                    raise ValueError('Unsafe official source redirect')
                current=dest
                continue
            r.raise_for_status()
            if len(r.content)>2_000_000:
                raise ValueError('Source response too large')
            return r.text
    raise ValueError('Official source exceeded safe redirect limit')

def parse_pib(xml):
    items=[]
    root=ET.fromstring(xml)
    for it in root.findall('.//item'):
        f={el.tag.split('}')[-1].lower():''.join(el.itertext()).strip() for el in it}
        title=f.get('title','').strip()
        url=f.get('link','')
        try: day=parsedate_to_datetime(f.get('pubdate','')).date().isoformat()
        except Exception:continue
        if title and safe_source(url):
            desc=BeautifulSoup(f.get('description',''),'html.parser').get_text(' ',strip=True)
            items.append({'title':title,'url':url,'published_date':day,'date_precision':'day','source':'PIB','source_text':desc})
    return items

def parse_prs(html):
    soup=BeautifulSoup(html,'html.parser')
    months={m:i for i,m in enumerate(['january','february','march','april','may','june','july','august','september','october','november','december'],1)}
    out=[];seen=set()
    for a in soup.select('a[href]'):
        url=urljoin(PRS,a['href'])
        if not safe_source(url):continue
        m=re.search(r'/policy/monthly-policy-review/('+ '|'.join(months) +r')-(20\d{2})(?:/|$|\?)',url,re.I)
        if not m or url in seen:continue
        month,year=m.group(1).lower(),int(m.group(2))
        out.append({'title':f'PRS Monthly Policy Review — {month.title()} {year}',
            'url':url,'published_date':f'{year}-{months[month]:02d}-01','date_precision':'month',
            'source':'PRS','source_text':'Policy review index; open source for complete coverage.'})
        seen.add(url)
    return sorted(out,key=lambda v:v['published_date'],reverse=True)

def as_article(row,owner_id=None):
    tags,relevance=classify(row['title'],row.get('source_text',''))
    unique='|'.join([row['source'],row.get('url') or '',row['title'],row['published_date'],owner_id or ''])
    digest=hashlib.sha256(unique.encode()).hexdigest()
    return {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,digest)), 'owner_id':owner_id,
        'source':row['source'],'url':row.get('url'), 'title':row['title'][:450],
        'published_date':row['published_date'],'date_precision':row.get('date_precision','day'),
        'source_text':row.get('source_text','')[:40000],
        'excerpt':row.get('source_text','')[:500], 'tags':tags,'relevance':relevance,
        'content_hash':digest}

def ingest_public_sources():
    result={'ran_at':utcnow(),'added':0,'errors':[],'sources':{}}
    for source,url,parser,limit in [('PIB',PIB,parse_pib,45),('PRS',PRS,parse_prs,8)]:
        try:
            # Try PIB's second official English feed only when primary fails/has no items.
            urls=[PIB,PIB_ALTERNATE] if source=='PIB' else [url]
            parsed=[]
            last_error=None
            for source_url in urls:
                try:
                    raw=safe_fetch(source_url)
                    parsed=parser(raw)[:limit]
                    if not parsed:
                        raise ValueError('No valid articles found in official source response')
                    break
                except (ValueError,httpx.HTTPError,ET.ParseError) as e:
                    last_error=e
            if not parsed:
                raise last_error or ValueError('No source articles')
            rows=[as_article(p) for p in parsed]
            # Ignore duplicate IDs; never replace previously approved analyses.
            added=rest_write('articles',rows,on_conflict='id',ignore_duplicates=True)
            result['added']+=len(added)
            result['sources'][source]={'found':len(rows),'added':len(added)}
        except (RuntimeError,ValueError,httpx.HTTPError,ET.ParseError) as e:
            detail=f'HTTP {e.response.status_code}' if isinstance(e,httpx.HTTPStatusError) else str(e)[:75] if isinstance(e,ValueError) else type(e).__name__
            result['errors'].append(f'{source}: {detail}')
    return result

def new_token():return secrets.token_urlsafe(32)
