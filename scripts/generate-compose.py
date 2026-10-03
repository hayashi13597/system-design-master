import json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
paths={'00':'module-00-foundations','01':'module-01-load-balancing','02':'module-02-caching-patterns','03':'module-03-rate-limiter','04':'module-04-db-replication','05':'module-05-db-sharding','06':'module-06-distributed-lock','07':'module-07-message-queues','08':'module-08-outbox-kafka','09':'capstone-flash-sale','10':'module-10-reliability'}
for lab,path in paths.items():
 directory=root/'labs'/path;directory.mkdir(parents=True,exist_ok=True)
 volumes={'pgdata':{}}
 pg={'image':'postgres:16.10-alpine','environment':{'POSTGRES_USER':'postgres','POSTGRES_PASSWORD':'lab_password','POSTGRES_DB':'lab'},'ports':['127.0.0.1:55432:5432'],'volumes':['pgdata:/var/lib/postgresql/data','../../infra/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro'],'healthcheck':{'test':['CMD-SHELL','pg_isready -h 127.0.0.1 -U postgres -d lab'],'interval':'2s','timeout':'2s','retries':30}}
 services={'postgres':pg}
 env={'LAB':lab,'DB_URL':'postgres://postgres:lab_password@postgres:5432/lab','REDIS_URL':'redis://redis:6379','RABBIT_URL':'amqp://lab:lab_password@rabbitmq','KAFKA_BROKERS':'redpanda:9092','RESERVATION_TTL_SECONDS':'${RESERVATION_TTL_SECONDS:-600}'}
 depends={'postgres':{'condition':'service_healthy'}}
 if lab in ['01','02','03','06','09']:
  volumes['redisdata']={};services['redis']={'image':'redis:7.4.6-alpine','command':['redis-server','--appendonly','yes'],'volumes':['redisdata:/data'],'ports':['127.0.0.1:56379:6379'],'healthcheck':{'test':['CMD','redis-cli','ping'],'interval':'2s','timeout':'2s','retries':20}}
  depends['redis']={'condition':'service_healthy'}
 if lab in ['07','09']:
  volumes['rabbitdata']={};services['rabbitmq']={'image':'rabbitmq:3.13.7-management-alpine','environment':{'RABBITMQ_DEFAULT_USER':'lab','RABBITMQ_DEFAULT_PASS':'lab_password'},'volumes':['rabbitdata:/var/lib/rabbitmq'],'ports':['127.0.0.1:55672:5672','127.0.0.1:15672:15672'],'healthcheck':{'test':['CMD','rabbitmq-diagnostics','-q','ping'],'interval':'3s','timeout':'5s','retries':40}}
  depends['rabbitmq']={'condition':'service_healthy'}
 if lab=='08':
  volumes['kafkadata']={};services['redpanda']={'image':'docker.redpanda.com/redpandadata/redpanda:v24.3.18','command':['redpanda','start','--smp','1','--memory','512M','--reserve-memory','0M','--overprovisioned','--node-id','0','--check=false','--kafka-addr','internal://0.0.0.0:9092,external://0.0.0.0:19092','--advertise-kafka-addr','internal://redpanda:9092,external://localhost:19092'],'volumes':['kafkadata:/var/lib/redpanda/data'],'ports':['127.0.0.1:19092:19092'],'healthcheck':{'test':['CMD-SHELL','rpk cluster health --exit-when-healthy'],'interval':'3s','timeout':'5s','retries':40}}
  depends['redpanda']={'condition':'service_healthy'}
 if lab=='04':
  pg['command']=['postgres','-c','wal_level=replica','-c','max_wal_senders=10','-c','max_replication_slots=10','-c','wal_keep_size=128MB']
  pg['volumes'] += ['../../infra/replication.sql:/docker-entrypoint-initdb.d/02-replication.sql:ro','../../infra/primary.sh:/docker-entrypoint-initdb.d/03-primary.sh:ro']
  for i in [1,2]:
   volumes[f'replica{i}data']={}
   services[f'replica{i}']={'image':'postgres:16.10-alpine','entrypoint':['sh','/replica.sh'],'environment':{'POSTGRES_PASSWORD':'replication_lab','PGDATA':'/var/lib/postgresql/data/replica'},'volumes':[f'replica{i}data:/var/lib/postgresql/data','../../infra/replica.sh:/replica.sh:ro'],'depends_on':{'postgres':{'condition':'service_healthy'}},'healthcheck':{'test':['CMD-SHELL','pg_isready -h 127.0.0.1 -U postgres -d lab'],'interval':'2s','timeout':'2s','retries':40}}
   depends[f'replica{i}']={'condition':'service_healthy'}
 if lab=='05':
  for i in [1,2,3,4]:
   volumes[f'shard{i}data']={}
   services[f'shard{i}']={'image':'postgres:16.10-alpine','environment':pg['environment'],'volumes':[f'shard{i}data:/var/lib/postgresql/data','../../infra/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro'],'healthcheck':pg['healthcheck']}
   if i==4: services[f'shard{i}']['profiles']=['reshard']
   else:depends[f'shard{i}']={'condition':'service_healthy'}
 def app(role='api',index=1):
  return {'build':{'context':'../..','dockerfile':'infra/Dockerfile'},'image':'system-design-lab:local','environment':{**env,'ROLE':role,'INSTANCE_ID':f'{role}-{index}','WORKER_ID':str(index)},'depends_on':depends.copy(),'init':True,'restart':'on-failure','stop_grace_period':'10s'}
 for i in range(1,4 if lab=='01' else 3):
  services[f'app-{i}']=app(index=i)
  services[f'app-{i}']['ports']=[f'127.0.0.1:{3000+i}:3000']
  services[f'app-{i}']['healthcheck']={'test':['CMD','node','-e',"fetch('http://localhost:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],'interval':'3s','timeout':'4s','retries':30}
 if lab in ['07','08','09']:
  services['consumer-1']=app('consumer',1);services['consumer-2']=app('consumer',2)
 if lab in ['08','09']:services['relay']=app('relay')
 if lab=='09':services['expiry']=app('expiry')
 if lab=='10':
  services['dependency']=app('dependency');services['dependency']['ports']=['127.0.0.1:3004:3000']
 nginx=(root/'infra/nginx.conf').read_text()
 if lab!='01':nginx=nginx.replace('   server app-3:3000 max_fails=1 fail_timeout=2s;\n','')
 (directory/'nginx.conf').write_text(nginx)
 services['nginx']={'image':'nginx:1.28.0-alpine','ports':['127.0.0.1:8080:8080'],'volumes':['./nginx.conf:/etc/nginx/nginx.conf:ro'],'depends_on':{k:{'condition':'service_healthy'} for k in services if k.startswith('app-')}}
 volumes['promdata']={};volumes['grafanadata']={}
 services['prometheus']={'image':'prom/prometheus:v3.5.0','profiles':['observability'],'ports':['127.0.0.1:9090:9090'],'volumes':['../../infra/prometheus.yml:/etc/prometheus/prometheus.yml:ro','promdata:/prometheus']}
 services['grafana']={'image':'grafana/grafana:12.1.1','profiles':['observability'],'ports':['127.0.0.1:3005:3000'],'environment':{'GF_SECURITY_ADMIN_PASSWORD':'lab_password'},'volumes':['grafanadata:/var/lib/grafana','../../infra/grafana:/etc/grafana/provisioning:ro']}
 (directory/'docker-compose.yml').write_text(json.dumps({'name':f'sdm-{lab}','services':services,'volumes':volumes},indent=2)+'\n')
