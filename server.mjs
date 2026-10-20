import {startupError} from './backend/startup-error.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadConfig} from './backend/config.mjs';
import {LiveWorker} from './backend/worker.mjs';
const root=new URL('./dist/',import.meta.url),config=loadConfig(),worker=new LiveWorker(config);
if(config.enabled&&config.missing.length)throw Error('Missing required live configuration: '+config.missing.join(', '));
try{await worker.init()}catch(e){worker.message='Integration configuration requires attention';worker.lastError=e.message;console.error(startupError(e,worker.startupStage));if(config.enabled)process.exit(1)}
await worker.refreshCatalog();
const timer=setInterval(()=>worker.tick(),5000);await worker.tick();
const json=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const server=http.createServer(async(req,res)=>{try{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");const url=new URL(req.url,'http://localhost');if(req.method!=='GET'){res.writeHead(405);res.end();return}if(url.pathname==='/api/state')return json(res,worker.publicState());if(url.pathname==='/api/health')return json(res,{service:'PumpCards',mode:'live',enabled:config.enabled,ready:worker.started&&!worker.state.halted&&!worker.catalogError,paused:Boolean(worker.state.halted),missing:config.missing,catalogConnected:!worker.catalogError,catalogAt:worker.catalogAt});const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','style.css','live.css','app.js','catalog.js','pumpcards-logo.png'].includes(name)){res.writeHead(404);res.end('Not found');return}const data=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)}catch{res.writeHead(500);res.end('Unavailable')}});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=50;
server.listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log('PumpCards: http://127.0.0.1:'+ (process.env.PORT||4173)));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);server.close(()=>process.exit(0))});
