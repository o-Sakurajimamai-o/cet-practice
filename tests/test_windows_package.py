"""Integration checks against the built EXE in relocated directories, with no developer Python/Node on PATH."""
import hashlib, json, os, shutil, socket, sqlite3, subprocess, time, tempfile, uuid, zipfile
from pathlib import Path
from urllib.parse import quote
import urllib.error, urllib.request

BASE=Path(__file__).resolve().parents[1]
STAGE=BASE
zip_path=BASE/'release-assets/CET-Practice-v1.3.0-Windows-x64.zip'
unpacked=Path(tempfile.mkdtemp(prefix='CET ZIP 验证 '))
with zipfile.ZipFile(zip_path) as archive:
    archive.extractall(unpacked)
PACKAGE=unpacked/'CET-Practice'
REPORT=BASE/'release-assets/verification-Windows-x64.json'
checks=[]
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def check(label,value):
    if not value:raise AssertionError(label)
    checks.append(label)

def request(port,path,method='GET',body=None,headers=None):
    raw=json.dumps(body).encode() if body is not None else None
    h={'Content-Type':'application/json'}
    h.update(headers or {})
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=raw,method=method,headers=h)
    try:
        with opener.open(req,timeout=10) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as r:return r.code,dict(r.headers),r.read()

def json_request(port,path,method='GET',body=None):
    status,headers,raw=request(port,path,method,body)
    if status!=200:raise RuntimeError(f'{path}: {status} {raw[:200]!r}')
    return json.loads(raw)

def launch(home,port=8765):
    log=(home/'test-process.log').open('ab')
    env=os.environ.copy()
    env['PATH']=str(Path(os.environ.get('SystemRoot',r'C:\Windows'))/'System32')
    for key in list(env):
        if key.startswith(('CET6_','CET_','PYTHON')):env.pop(key,None)
    p=subprocess.Popen([str(home/'CET-Practice.exe'),'--no-browser','--port',str(port)],cwd=BASE,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(180):
        if p.poll() is not None:raise RuntimeError('EXE exited early: '+(home/'test-process.log').read_text(encoding='utf-8',errors='replace')[-3000:])
        try:
            record=json.loads((home/'data/server.json').read_text(encoding='utf-8'))
            if record['pid']==p.pid and json_request(record['port'],'/api/health')['ok']:
                return p,record,log
        except (OSError,ValueError,RuntimeError):pass
        time.sleep(.1)
    p.terminate();raise RuntimeError('Portable startup timed out')

def stop(home,p,log):
    result=subprocess.run([str(home/'CET-Practice.exe'),'--stop'],capture_output=True,timeout=20,creationflags=subprocess.CREATE_NO_WINDOW)
    check('graceful stop command',result.returncode==0)
    p.wait(timeout=20);log.close()
    check('server exits cleanly',p.returncode==0)
    check('runtime instance file removed',not (home/'data/server.json').exists())

try:
    # Use an actual different drive plus Chinese and spaces in the folder name.
    relocated=Path(os.environ['CET_TEST_ROOT']) if os.environ.get('CET_TEST_ROOT') else Path(tempfile.mkdtemp(prefix='四六级 便携 验证 '))
    relocated.mkdir(exist_ok=True)
    run_stamp=str(int(time.time()))
    home=relocated/('CET-Practice-'+run_stamp)
    if home.exists():raise RuntimeError('Fresh isolated verification target already exists')
    shutil.copytree(PACKAGE,home)
    blocker=socket.socket();blocker.bind(('127.0.0.1',0));blocker.listen()
    occupied=blocker.getsockname()[1]
    p,record,log=launch(home,occupied)
    port=record['port']
    check('occupied port handled without terminating another process',port!=occupied and blocker.fileno()!=-1)
    blocker.close()
    check('first launch creates external user database',(home/'data/cet6.db').is_file())
    check('static frontend served',b'id="root"' in request(port,'/')[2])
    papers=json_request(port,'/api/papers')['papers']
    check('all 122 papers present',len(papers)==122)
    check('5845 objective questions indexed',sum(paper['objective_total'] for paper in papers)==5845)
    with sqlite3.connect(home/'data/cet6.db') as c:
        check('fresh user data contains no personal records',all(c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]==0 for t in ['sessions','wrong_book','favorites','notes','text_marks','manual_fixes','meta']))
        check('6089 questions preserved',c.execute('SELECT COUNT(*) FROM questions').fetchone()[0]==6089)
        check('all objective answers and explanations present',c.execute("SELECT COUNT(*) FROM questions WHERE qtype IN ('mcq','blank','match') AND (trim(coalesce(answer,''))='' OR trim(coalesce(analysis_text,''))='')").fetchone()[0]==0)
        check('database integrity',c.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
        audio_rows=c.execute("SELECT paper_key,audio_path FROM papers WHERE audio_path IS NOT NULL AND audio_path!=''").fetchall()
        check('95 playable sets with 76 distinct audio files',len(audio_rows)==95 and len({path for key,path in audio_rows})==76 and all((home/'resources'/path).is_file() for key,path in audio_rows))
        uid,paper_key,answer,source=c.execute("SELECT uid,paper_key,answer,source_file FROM questions WHERE qtype='mcq' AND answer IS NOT NULL ORDER BY uid LIMIT 1").fetchone()
    c.close()
    for key,rel in audio_rows:
        status,headers,body=request(port,'/api/audio/'+key,headers={'Range':'bytes=0-1023'})
        check('audio initial range '+key,status==206 and len(body)==1024 and body==(home/'resources'/rel).read_bytes()[:1024])
    four=json_request(port,'/api/papers?exam=cet4')['papers']
    six=json_request(port,'/api/papers?exam=cet6')['papers']
    check('CET4 filter and objective count',len(four)==46 and sum(x['objective_total'] for x in four)==2530)
    check('CET6 filter preserved',len(six)==76 and sum(x['objective_total'] for x in six)==3315)
    four_detail=json_request(port,'/api/questions/cet4-2026-06-3:listening:25')
    check('CET4 sentence insights retained',any(m.get('content',{}).get('sentence_insights') for m in four_detail.get('materials',[])))
    check('CET4 last-question explanation separated',bool(four_detail.get('analysis_text')) and 'S E N T E N C E' not in four_detail['analysis_text'])
    check('Linux Do friend link retained','https://linux.do/' in (home/'README.md').read_text(encoding='utf8'))
    status,headers,body=request(port,'/api/audio/'+audio_rows[0][0],headers={'Range':'bytes=-257'})
    check('audio suffix seek',status==206 and len(body)==257)
    status,headers,body=request(port,'/api/audio/'+audio_rows[0][0],headers={'Range':'bytes=999999999999-'})
    check('invalid audio range rejected',status==416)
    status,headers,body=request(port,'/api/pdf?path='+quote(source))
    check('optional PDF absence clearly explained',status==404 and '尚未安装'.encode() in body)
    detail=json_request(port,'/api/questions/'+quote(uid))
    check('question details and explanation available',bool(detail.get('analysis_text')))
    sid=json_request(port,'/api/sessions?paper_key='+paper_key,'POST')['session_id']
    json_request(port,f'/api/sessions/{sid}','PUT',{'answers':{uid:answer},'elapsed_sec':123,'audio_pos':12.5})
    check('answer saved',json_request(port,f'/api/sessions/{sid}')['session']['answers'].get(uid)==answer)
    mark={'id':str(uuid.uuid4()),'paper_key':paper_key,'section':'listening','passage_index':1101,'start_offset':0,'end_offset':4,'text':'test','created_at':'2026-10-27T00:00:00+08:00'}
    check('text mark saved',json_request(port,'/api/marks','POST',mark)['id']==mark['id'])
    check('text mark exported in backup',json_request(port,'/api/backup/export')['text_marks'][0]['id']==mark['id'])
    denied=request(port,'/api/local/shutdown','POST')[0]
    check('unauthorized shutdown request rejected',denied==403)
    duplicate=subprocess.run([str(home/'CET-Practice.exe'),'--no-browser'],capture_output=True,timeout=20,creationflags=subprocess.CREATE_NO_WINDOW)
    check('repeat launcher reuses existing instance',duplicate.returncode==0 and p.poll() is None)
    from playwright.sync_api import sync_playwright
    from browser_practice_checks import check_practice_features
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{port}/')
        page.get_by_role('button',name='英语四级').click()
        page.get_by_role('button',name='开始练习',exact=True).click()
        page.wait_for_selector('.qcard')
        check_practice_features(page,check)
        page.screenshot(path=str(BASE/'release-assets/browser-Windows-x64.png'),full_page=True)
        check('no browser script errors',not errors)
        browser.close()
    stop(home,p,log)
    second=relocated/('CET-Practice moved again '+run_stamp)
    home.rename(second);home=second
    p,record,log=launch(home,0)
    port=record['port']
    restored=json_request(port,f'/api/sessions/{sid}')['session']
    check('answers survive restart and folder relocation',restored['answers'].get(uid)==answer)
    check('timer and audio position survive restart',restored['elapsed_sec']==123 and restored['audio_pos']==12.5)
    check('text mark survives restart',json_request(port,'/api/marks?paper_key='+paper_key+'&section=listening')['marks'][0]['id']==mark['id'])
    json_request(port,f'/api/sessions/{sid}/submit','POST')
    check('submission and history available',bool(json_request(port,'/api/history')))
    backup=json_request(port,'/api/backup/export')
    check('personal backup export available',backup['format']=='cet6-backup')
    # Add only one optional PDF to verify the supplementary folder convention.
    pdf=home/'resources'/source;pdf.parent.mkdir(parents=True,exist_ok=True)
    pdf.write_bytes(b'%PDF-1.4\n% optional resource test\n%%EOF\n')
    status,headers,body=request(port,'/api/pdf?path='+quote(source))
    check('optional PDF works after adding resources',status==200 and body[:4]==b'%PDF')
    stream=opener.open(f'http://127.0.0.1:{port}/api/audio/{audio_rows[0][0]}',timeout=10)
    stream.read(1024)
    stop_started=time.monotonic()
    stop(home,p,log)
    check('active audio stream does not block shutdown indefinitely',time.monotonic()-stop_started<18)
    stream.close()
    # Upgrade a separate v1.1.0 personal database without replacing its progress.
    legacy_home=relocated/('CET-legacy-'+run_stamp)
    shutil.copytree(home,legacy_home,ignore=shutil.ignore_patterns('resources','data','test-process.log'))
    (legacy_home/'data').mkdir()
    shutil.copy2(BASE/'build-input/legacy-v1.1.0-cet6.db',legacy_home/'data/cet6.db')
    with sqlite3.connect(legacy_home/'data/cet6.db') as db:
        db.execute("INSERT INTO sessions(paper_id,mode,answers_json,elapsed_sec) SELECT id,'full','{}',77 FROM papers LIMIT 1")
        db.commit()
    home=legacy_home
    p,record,log=launch(home,0)
    with sqlite3.connect(home/'data/cet6.db') as db:
        check('old Windows progress survives upgrade',db.execute('SELECT elapsed_sec FROM sessions').fetchone()[0]==77)
        check('old Windows database gains text mark table',db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='text_marks'").fetchone()[0]==1)
    stop(home,p,log)
    REPORT.write_text(json.dumps({'passed':True,'checks':checks,'relocated_test_directory':str(home)},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':True,'check_count':len(checks),'report':str(REPORT)},ensure_ascii=True))
except BaseException as exc:
    if 'p' in globals() and p.poll() is None:
        try:stop(home,p,log)
        except Exception: p.terminate();p.wait(timeout=10)
    REPORT.write_text(json.dumps({'passed':False,'checks':checks,'error':str(exc)},ensure_ascii=False,indent=2),encoding='utf-8')
    raise
