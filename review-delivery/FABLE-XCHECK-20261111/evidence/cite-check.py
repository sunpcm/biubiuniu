import re,sys,os,subprocess
repo=sys.argv[1]; text=open(sys.argv[2],encoding='utf-8').read()
files=subprocess.run(['git','-C',repo,'ls-files'],capture_output=True,text=True).stdout.split('\n')
pat=re.compile(r'`([A-Za-z0-9_@\[\]\(\)./-]+\.(?:ts|tsx|mjs|sql|json|md|js))((?::\d+(?:-\d+)?)?)`((?:、`:\d+(?:-\d+)?`)*)')
bad=[];n=0
for m in pat.finditer(text):
    p=m.group(1); refs=[m.group(2)]+re.findall(r':\d+(?:-\d+)?',m.group(3) or '')
    refs=[r for r in refs if r]
    if not refs: continue
    cands=[f for f in files if f==p or f.endswith('/'+p)]
    if len(cands)!=1:
        bad.append((p,refs,'UNRESOLVED(%d)'%len(cands))); continue
    L=sum(1 for _ in open(os.path.join(repo,cands[0]),encoding='utf-8',errors='replace'))
    for r in refs:
        n+=1
        hi=int(re.findall(r'\d+',r)[-1])
        if hi>L: bad.append((cands[0],r,'file has %d lines'%L))
print('checked',n,'line refs'); 
for b in bad: print(b)
