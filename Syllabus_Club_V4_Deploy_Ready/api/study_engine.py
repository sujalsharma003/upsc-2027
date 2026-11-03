
"""UPSC Prelims rule-based reading scaffold. No model use and no invented facts."""
SYLLABUS={
 'Polity':['GS I: Indian Polity and Governance','Constitution, Parliament and institutions'],
 'Economy':['GS I: Economic and Social Development','Fiscal, monetary and sectoral policy'],
 'Environment':['GS I: Environment and Ecology','Biodiversity, climate and conservation'],
 'Geography':['GS I: Indian and World Geography','Physical and economic geography'],
 'Science & Tech':['GS I: General Science','Science and technology applications'],
 'International Relations':['GS I: Current events','India and international relations'],
 'History & Culture':['GS I: History and Culture','Indian heritage and culture'],
 'Social Issues':['GS I: Economic and Social Development','Welfare, education, health and inclusion']
}
DRILLS={
 'Polity':['Identify the institution or law named and its legal basis, if any.','Which level of government is responsible for implementation?'],
 'Economy':['Define the indicator, scheme or policy instrument in the original source.','Which regulator, ministry or sector is involved?'],
 'Environment':['Identify the ecosystem, species or law and relevant conservation measures.','Which environment concept is worth revising?'],
 'Geography':['Locate the place, river or region on a map.','What geographic process or feature is involved?'],
 'Science & Tech':['Identify the underlying scientific principle or technology.','How is it different from similar technologies in the syllabus?'],
 'International Relations':['Identify the organization, member countries or treaty.','What is India’s relationship to the institution or agreement?'],
 'History & Culture':['Identify the era, site or tradition mentioned.','Which specific historical features are Prelims-relevant?'],
 'Social Issues':['Identify the beneficiary group and policy institution.','What are the eligibility criteria and statutory basis, if applicable?']
}
CEREMONIAL=('congratulates','greets on','condoles','pays tribute','extends greetings','wishes on')

def study_guidance(article):
    """Subject and recall mapping derived only from article metadata, not article facts."""
    title=(article.get('title') or '').strip()
    tags=[t for t in (article.get('tags') or []) if t in SYLLABUS][:3]
    score=max(0,min(100,int(article.get('relevance') or 0)))
    if any(term in title.lower() for term in CEREMONIAL):
        score=max(0,score-32)
    priority='high' if score>=65 else 'medium' if score>=40 else 'review'
    links=list(dict.fromkeys(s for t in tags for s in SYLLABUS[t]))[:5]
    questions=['Read the original source; write down only dates, terms and figures it explicitly supports.']
    questions.extend(DRILLS.get(tags[0],['Which syllabus topic, if any, does this event relate to?']) if tags else ['Which syllabus topic, if any, does this event relate to?'])
    questions.append('Write a one-sentence summary in your own words and verify it against the original.')
    return {'rule_based':True,'priority':priority,'syllabus_links':links,
            'recall_questions':questions[:4],
            'source_warning':'Only a source preview may be available. Open the official page to verify details.',
            'reading_minutes':3 if priority=='review' else 5}
