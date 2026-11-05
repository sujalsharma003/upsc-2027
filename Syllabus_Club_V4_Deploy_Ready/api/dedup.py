"""Conservative cross-source UPSC news story matching.

High-confidence overlap only: keep differently reported developments separate.
Never delete imported user documents or modify existing study/AI notes.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from datetime import date

STOP = frozenset((
    "a an the and or on in at by to for of with as from into within after before"
    " is are was were be been being have has had this that these those its their"
    " will would shall should about across amid among due under over through during"
    " new latest update updates news important current affairs official report"
    " reports according says said of the a an english hindi"
).split())

# Only spelling/inflection variants and very close action synonyms.
SYNONYMS = {
    "approves":"approve", "approved":"approve", "approval":"approve",
    "clears":"approve", "cleared":"approve", "clearance":"approve",
    "launches":"launch", "launched":"launch", "launching":"launch",
    "inaugurates":"inaugurate", "inaugurated":"inaugurate",
    "announces":"announce", "announced":"announce", "announcement":"announce",
    "releases":"release", "released":"release", "publishes":"release",
    "increases":"increase", "increased":"increase", "raises":"increase",
    "recommends":"recommend", "recommended":"recommend",
    "extends":"extend", "extended":"extend",
    "establishes":"establish", "established":"establish",
    "signs":"sign", "signed":"sign",
    "policies":"policy", "schemes":"scheme", "programmes":"programme",
    "programs":"programme", "government":"govt", "governments":"govt",
    "ministerial":"minister", "committees":"committee",
    "centres":"centre", "centers":"centre",
    "ministers":"minister", "ministries":"ministry",
    "crores":"crore", "rupees":"rs", "rupee":"rs", "rs":"rs",
    "financing":"funding", "fund":"funding",
    "national":"national", "indian":"india"
}

def tokenize(text):
    normalized = unicodedata.normalize("NFKC", str(text or "")).casefold()
    normalized = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", normalized)
    words = re.findall(r"[\w]+", normalized, flags=re.UNICODE)
    return [SYNONYMS.get(w,w) for w in words
            if (len(w)>2 or w.isdecimal()) and w not in STOP and not w.startswith("_")]

def _numbers(text):
    s = unicodedata.normalize("NFKC",str(text or ""))
    return {x for x in re.findall(r"\b\d[\d,]*(?:\.\d+)?\b",s)
            if len(x.replace(",",""))>=2 and not 1900<=int(x.replace(",","").split(".")[0])<=2100}

def _amount_conflict(a,b):
    a,b=_numbers(a),_numbers(b)
    # Two explicit conflicting amounts are often separate events.
    return bool(a and b and not (a & b))

def headline_score(title1,title2):
    """1.0 indicates the same event title, even if wording/order varies."""
    if _amount_conflict(title1,title2):return 0.0
    a,b=set(tokenize(title1)),set(tokenize(title2))
    if min(len(a),len(b))<3:return 0.0
    common=len(a & b)
    if common<3:return 0.0
    coverage=common/min(len(a),len(b))
    jaccard=common/len(a | b)
    # Generic three-token overlaps are not grounds for collapsing news.
    if common<4 and (len(a)>5 or len(b)>5):return 0.0
    score=0.55*coverage+0.45*jaccard
    if common>=4 and coverage>=.90 and jaccard>=.60:
        return max(score,.89)
    return score

def same_news(title1,title2, min_score=.84):
    return headline_score(title1,title2)>=min_score

def _within_days(left,right,days=55):
    try:return abs((date.fromisoformat(str(left)[:10])-date.fromisoformat(str(right)[:10])).days)<=days
    except (ValueError,TypeError):return False

def duplicate_public_match(article,candidate):
    if article.get("source")==candidate.get("source"):return False
    if article.get("source") not in ("PIB","PRS") or candidate.get("source") not in ("PIB","PRS"):
        return False
    if not _within_days(article.get("published_date"),candidate.get("published_date")):return False
    return same_news(article.get("title",""),candidate.get("title",""))

def _doc_windows(tokens, target_size):
    # Search local passages, never combine terms from unrelated PDF pages.
    length=min(95,max(20,round(target_size*2.4)))
    step=max(1,length//7)
    for i in range(0,len(tokens),step):
        yield tokens[i:i+length]
        if i+length>=len(tokens):break

def pdf_overlaps(text, candidates, *, max_results=20):
    """Match contained news topics by proximity of meaningful headline words.

    A large magazine with one overlapping story must not be discarded wholesale.
    """
    tok=tokenize(text)[:8500]
    full=set(tok)
    found=[]
    for c in candidates:
        title=str(c.get("title") or "")
        target=set(tokenize(title))
        if len(target)<4 or len(target & full)<max(4,round(len(target)*.73)):
            continue
        if c.get("source") not in ("PIB","PRS","PDF"):
            continue
        best=0.0
        for window in _doc_windows(tok,len(target)):
            local=set(window)
            coverage=len(local&target)/len(target)
            if coverage>best:best=coverage
            if best>=.96:break
        if best<.79:continue
        # Numbers can differ across policy reports: a conflicting figure
        # in a nearby title is not necessarily the same event.
        found.append({
            "id":str(c["id"]),
            "source":str(c.get("source") or ""),
            "title":title[:450],
            "url":str(c.get("url") or "")[:800],
            "confidence":round(best,3),
        })
    found.sort(key=lambda m:(-m["confidence"],m["source"]!="PIB",m["title"]))
    return found[:max_results]

def first_story_title(extracted,filename):
    raw=extracted.splitlines() if "\n" in extracted else [extracted]
    lines=[x.strip() for x in raw if len(x.strip())>12 and len(x.strip())<280]
    for x in lines[:8]:
        if len(tokenize(x))>=4 and not re.search(r"\b(contents|issue|index|editorial|page\s+\d+|monthly magazine)\b",x,re.I):
            return x
    name=re.sub(r"\.pdf$","",filename or "",flags=re.I)
    return re.sub(r"[_-]+"," ",name)

def is_single_story_duplicate(extracted, *, pages, filename, matches, existing):
    """Skip only a short, clearly single-story PDF already in the archive.

    Length is intentionally conservative to preserve multi-topic documents.
    """
    if pages!=1 or len(extracted)>2400 or not matches:
        return None
    # Existing PDF title is often its filename; official sources are preferable.
    best=matches[0]
    official=next((r for r in existing if str(r.get("id"))==best["id"]),None)
    if not official:return None
    source_title=official.get("title") or ""
    top_title=first_story_title(extracted,filename)
    confidence=headline_score(top_title,source_title)
    words=tokenize(extracted)
    if len(words)<18:return None
    # The other source's title/event must be front-and-centre.
    start=" ".join(extracted.split()[:80])
    near_first=pdf_overlaps(start,[official],max_results=1)
    if confidence>=.84 and near_first and near_first[0]["confidence"]>=.80:
        return best
    return None

def scoped_candidates(user_id, fetch_rows):
    """Paginate visible public and same-owner article metadata; never scan others."""
    collected=[]
    for offset in range(0,5000,500):
        rows=fetch_rows("articles",{
            "or":f"(owner_id.is.null,owner_id.eq.{user_id})",
            "select":"id,source,owner_id,title,url,published_date,content_hash,analysis,file_name",
            "order":"published_date.desc,added_at.desc","offset":str(offset)},500)
        collected.extend(rows)
        if len(rows)<500:break
    return collected

def file_digest(owner_id, blob):
    # Owner-salted SHA256 prevents dedup across private users.
    return hashlib.sha256(str(owner_id).encode()+b"\0"+blob).hexdigest()

def group_public_stories(rows, progress=None, source_filter="all"):
    """Collapse duplicate public-source cards without touching stored articles."""
    if source_filter!="all":
        return rows,0
    progress=progress or {}
    visible=[]
    suppressed=0
    for row in rows:
        old=None
        for parent in visible:
            if duplicate_public_match(parent,row):
                old=parent;break
        if not old:
            visible.append(dict(row))
            continue
        # Prefer the entry with saved notes or user interaction.
        def quality(item):
            p=progress.get(item["id"],{})
            return (bool(item.get("analysis"))*6+
                    bool(p.get("revision_stage") or p.get("read_status") in ("read","saved"))*4+
                    (item.get("source")=="PIB")*2)
        if quality(row)>quality(old):
            visible.remove(old)
            old,row=dict(row),old
            visible.append(old)
        old.setdefault("alternate_sources",[])
        old["alternate_sources"].append({
            "id":str(row["id"]),"source":row.get("source"),
            "title":row.get("title"),"url":row.get("url")})
        suppressed+=1
    return visible,suppressed
