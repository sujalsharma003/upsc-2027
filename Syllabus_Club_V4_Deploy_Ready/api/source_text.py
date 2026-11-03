"""Read verifiable article-specific text from official PIB and PRS sources.

Only call after user authentication and core.safe_source URL allowlist checks.
No external search results or fabricated facts are used.
"""
from __future__ import annotations
import re
from urllib.parse import parse_qs, urlparse
from bs4 import BeautifulSoup

class MissingSourceText(ValueError):
    """Official source lacks enough article-specific evidence."""

def clean_text(text):
    return re.sub(r'\s+', ' ', text or '').strip()

def headline_key(title):
    title=re.sub(r'^\s*PRS:\s*','',title or '',flags=re.I)
    title=re.sub(r'\s*\(p\.\s*\d+\)\s*$','',title,flags=re.I)
    if '">' in title:
        title=title.rsplit('">',1)[-1]
    return clean_text(title).lower()

def same_headline(expected, candidate):
    expected=headline_key(expected)
    candidate=headline_key(candidate)
    if not expected or not candidate:
        return False
    if expected == candidate:
        return True
    # Allow PIB official typographic differences while preventing a different
    # release from being used accidentally.
    terms=lambda v:{t for t in re.findall(r'[a-z0-9]+',v) if len(t)>3}
    e,c=terms(expected),terms(candidate)
    return bool(e) and len(e & c)/len(e) >= 0.70

def parse_pib_article(html, title, release_id):
    soup=BeautifulSoup(html,'html.parser')
    heading=soup.select_one('.innner-page-main-about-us-content-right-part h1')
    if not heading:
        raise MissingSourceText('PIB article heading not found')
    heading_text=clean_text(heading.get_text(' ',strip=True))
    if not same_headline(title,heading_text):
        raise MissingSourceText('PIB page does not match the selected article')
    if release_id and release_id not in html:
        raise MissingSourceText('PIB page release identifier mismatch')
    root=soup.select_one('.innner-page-main-about-us-content-right-part')
    if not root:
        raise MissingSourceText('PIB article body not found')
    paragraphs=[]
    seen=set()
    for p in root.select('p'):
        text=clean_text(p.get_text(' ',strip=True))
        if len(text)<65 or text in seen:
            continue
        if text.lower().startswith(('javascript must be enabled','site is hosted','the website belongs')):
            continue
        seen.add(text)
        paragraphs.append(text)
        if sum(map(len,paragraphs))>13000:
            break
    body=clean_text(' '.join(paragraphs))
    if len(body)<160:
        raise MissingSourceText('Official PIB release has insufficient article text')
    return ('PIB original release: '+heading_text+'\n' +
            'Verified release ID: '+release_id+'\n\n'+body)[:15000]

def _prs_pairs(soup):
    container=soup.select_one('.view-policy-reviews .view-content')
    if container is None:
        raise MissingSourceText('PRS review highlights section not found')
    pairs=[]
    for node in container.find_all('p',recursive=False):
        strong=node.find('strong')
        if strong is None:
            continue
        title=clean_text(strong.get_text(' ',strip=True))
        if not re.search(r'\(p\.\s*\d+\)',title,re.I):
            continue
        nxt=node.find_next_sibling('p')
        paragraphs=[]
        while nxt is not None and len(paragraphs)<2:
            if nxt.find('strong') and re.search(r'\(p\.\s*\d+\)',nxt.get_text(' ',strip=True),re.I):
                break
            content=clean_text(nxt.get_text(' ',strip=True))
            if content and len(content)>35:
                paragraphs.append(content)
            nxt=nxt.find_next_sibling('p')
        if paragraphs:
            pairs.append((headline_key(title), ' '.join(paragraphs)))
    return pairs

def parse_prs_article(html, title, issue_month):
    soup=BeautifulSoup(html,'html.parser')
    pairs=_prs_pairs(soup)
    if not pairs:
        raise MissingSourceText('PRS page does not include readable review details')
    heading=headline_key(title)
    if heading.startswith('prs monthly policy review') or heading.startswith('monthly policy review'):
        excerpts=['- '+h+': '+p for h,p in pairs if p]
        body=clean_text('\n'.join(excerpts))
    else:
        matches=[p for h,p in pairs if same_headline(heading,h)]
        if len(matches)!=1:
            raise MissingSourceText('No unique PRS paragraph matches the selected highlight')
        body=clean_text(matches[0])
    if len(body)<75:
        raise MissingSourceText('PRS item has insufficient verified text')
    return ('PRS Monthly Policy Review '+issue_month+
            '\nSelected study topic: '+title+
            '\nVerified source excerpt:\n'+body)[:14000]

def fetch_verified_article(row, fetch):
    source=row.get('source')
    original=row.get('url') or ''
    url=urlparse(original)
    if url.scheme!='https' or url.username or url.password or url.port not in (None,443):
        raise MissingSourceText('Source URL is not a safe HTTPS URL')
    if source=='PIB':
        if url.hostname not in ('pib.gov.in','www.pib.gov.in'):
            raise MissingSourceText('PIB source host mismatch')
        if url.path.lower().strip('/') not in (
            'pressrelesedetail.aspx','pressreleasepage.aspx','pressreleaseiframepage.aspx'):
            raise MissingSourceText('PIB source path is not a verified press release')
        ids={key.lower():values for key,values in parse_qs(url.query).items()}
        rid=(ids.get('prid') or [''])[0]
        if not rid.isdigit():
            raise MissingSourceText('Official PIB release ID is missing')
        # The newer PressReleseDetail URL may render the wrong language or
        # a navigation-only shell. The legacy iframe serves English release text.
        safe_url='https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID='+rid
        return parse_pib_article(fetch(safe_url),row.get('title',''),rid)
    if source=='PRS':
        if url.hostname not in ('prsindia.org','www.prsindia.org'):
            raise MissingSourceText('PRS source host mismatch')
        match=re.fullmatch(r'/policy/monthly-policy-review/([a-z]+)-(20\d{2})/?',url.path,re.I)
        if not match:
            raise MissingSourceText('PRS URL is not an official monthly policy review')
        month=match.group(1).lower()
        months=('january','february','march','april','may','june','july',
                'august','september','october','november','december')
        if month not in months:
            raise MissingSourceText('PRS review month is invalid')
        issue_month=match.group(2)+'-'+str(months.index(month)+1).zfill(2)
        if not original.startswith('https://'):
            raise MissingSourceText('PRS source URL is invalid')
        return parse_prs_article(fetch(original),row.get('title',''),issue_month)
    raise MissingSourceText('Only official PIB and PRS source text is supported')
