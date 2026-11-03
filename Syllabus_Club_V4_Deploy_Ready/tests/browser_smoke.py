from playwright.sync_api import sync_playwright
from pathlib import Path
import json
BASE='file:///mnt/data/Syllabus_Club_V4_Cloud/public'
with sync_playwright() as p:
  b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width,height,name in [(1440,900,'desktop'),(390,844,'mobile')]:
    page=b.new_page(viewport={'width':width,'height':height})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/config',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps({'configured':True,'supabase_url':'https://demo.supabase.co','supabase_anon_key':'pub'})))
    page.goto(BASE+'/index.html',wait_until='networkidle')
    page.locator('#cloud-open').click()
    assert page.locator('#cloud-login').count()==1, 'No sign-in form'
    page.locator('#cloud-login [name=email]').fill('learner@example.com')
    page.locator('#cloud-login [name=password]').fill('secure-test-password')
    # Need capture mock sign-in/state.
    page.route('https://demo.supabase.co/auth/v1/token?grant_type=password', lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps({'access_token':'fake-token','refresh_token':'refresh','expires_in':3600,'user':{'id':'11111111-1111-4111-8111-111111111111','email':'learner@example.com'}})))
    page.route('**/api/state',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps({'revision':1,'saved':True} if r.request.method=='POST' else {'data':None,'revision':0})))
    page.route('**/api/health',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps({'online':True,'ai_enabled':False,'auto_sync':True,'last_sync':None})))
    page.locator('#cloud-login [data-mode="login"]').click()
    page.wait_for_timeout(1500)
    assert not errors,errors
    assert page.locator('#cloud-open').count()==1
    print(name,'cloud button:',page.locator('#cloud-open').inner_text())
    page.screenshot(path=str(Path(__file__).resolve().parents[1]/('v4-'+name+'.png')),full_page=False)
    print(name,'body scroll x',page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth'))
    page.close()
  b.close()
