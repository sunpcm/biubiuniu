import re,sys,pathlib
R=pathlib.Path(sys.argv[1])
def stmts(text):
    out=[]
    for s in text.split("--> statement-breakpoint"):
        s=re.sub(r"\s+"," ",s).strip().rstrip(";").strip()
        if not s: continue
        # split CREATE TABLE columns into a set for order-insensitive compare
        m=re.match(r'(CREATE TABLE "[^"]+") \((.*)\)$',s)
        if m:
            cols=sorted(c.strip() for c in re.split(r',(?![^()]*\))',m.group(2)))
            s=m.group(1)+" ("+" | ".join(cols)+")"
        out.append(s)
    return out
app="".join("\n--> statement-breakpoint\n"+(R/"apps/web/src/lib/db/migrations"/f).read_text() for f in ["0000_narrow_morbius.sql","0001_nappy_charles_xavier.sql","0002_nano.sql"])
mods=""
for f in ["auth","payments","credits","nano"]:
    t=(R/"packages/persistence-pg/src/migrations/modules"/(f+".ts")).read_text()
    m=re.search(r"sql:\s*`(.*?)`",t,re.S)
    mods+="\n--> statement-breakpoint\n"+m.group(1)
a=stmts(app); b=stmts(mods)
# fold ALTER TABLE ADD COLUMN impersonated_by into compare separately
A=set(a);B=set(b)
print("app stmts",len(a),"unique",len(A),"| module stmts",len(b),"unique",len(B))
print("only in app chain:");[print("  ",x[:220]) for x in sorted(A-B)]
print("only in modules:");[print("  ",x[:220]) for x in sorted(B-A)]
