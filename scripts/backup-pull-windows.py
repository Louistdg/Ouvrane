"""Copie privée de sauvegardes vérifiées ; aucune sortie de credentials."""
import argparse,hashlib,json,pathlib,re,sys,uuid,datetime
parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
config=json.loads(pathlib.Path(args.config).read_text(encoding='utf-8-sig'))
sys.path.insert(0,config['pythonDependencies'])
import paramiko
import msvcrt
destination=pathlib.Path(config['outputDirectory']);destination.mkdir(parents=True,exist_ok=True)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as file:
  for chunk in iter(lambda:file.read(1024*128),b''):h.update(chunk)
 return h.hexdigest()
def record(value):
 path=destination/'etat-rapatriement.json';temp=path.with_suffix('.partial');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
lock=(destination/'.rapatriement.lock').open('a+b');lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
except OSError:lock.close();sys.exit(0)
client=None;partial=None
try:
 credentials=pathlib.Path(config['credentialsFile']).read_text(encoding='utf-8-sig').splitlines()
 client=paramiko.SSHClient();client.load_system_host_keys(config['knownHostsFile'])
 client.connect(config['host'],username=credentials[2].split('\t')[-1].strip(),password=credentials[3].split('\t')[-1].strip(),look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=20,banner_timeout=20)
 s=client.open_sftp();s.get_channel().settimeout(30)
 try:
  remote=config['remoteDirectory'].rstrip('/')
  with s.open(remote+'/etat.json','rb') as file:state=json.loads(file.read(65536))
  if state.get('success') is not True:raise RuntimeError('La dernière sauvegarde serveur est en échec.')
  name=str(state.get('name',''));checksum=str(state.get('checksumSha256',''))
  if not re.fullmatch(r'socle-\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-f0-9-]+\.sqlite',name) or not re.fullmatch('[a-f0-9]{64}',checksum):raise RuntimeError('Métadonnées de sauvegarde invalides.')
  size=int(state['size']);remoteStat=s.stat(remote+'/'+name)
  if size<=0 or remoteStat.st_size!=size:raise RuntimeError('Taille serveur incohérente.')
  target=destination/name
  if not target.exists() or sha(target)!=checksum:
   partial=destination/('.'+name+'.'+str(uuid.uuid4())+'.partial')
   s.get(remote+'/'+name,str(partial))
   if partial.stat().st_size!=size or sha(partial)!=checksum:raise RuntimeError('Copie différente de la sauvegarde vérifiée.')
   # Le premier en-tête permet de détecter une erreur de format sans ouvrir la base.
   with partial.open('rb') as file:
    if file.read(16)!=b'SQLite format 3\x00':raise RuntimeError('Format SQLite invalide.')
   partial.replace(target);partial=None
  record({'success':True,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'snapshot':name,'size':size,'checksumSha256':checksum,'sourceBackupAt':state['at'],'retention':30})
  copies=sorted((p for p in destination.iterdir() if p.is_file() and re.fullmatch(r'socle-\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-f0-9-]+\.sqlite',p.name)),key=lambda p:p.name,reverse=True)
  # Toujours garder la génération qui vient d'être vérifiée, même si l'horloge a reculé.
  keep={target.name}
  for file in copies:
   if len(keep)>=30:break
   keep.add(file.name)
  for file in copies:
   if file.name not in keep:file.unlink()
 finally:s.close()
except Exception as error:
 record({'success':False,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'errorType':type(error).__name__,'message':'Copie non garantie ; les sauvegardes précédentes sont conservées.'})
 sys.exit(1)
finally:
 if partial:partial.unlink(missing_ok=True)
 if client:client.close()
 lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1);lock.close()
