import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const port = Number(process.env.PORT || 3000);
const sitePassword = process.env.SITE_PASSWORD || '';
if(!sitePassword){console.error('SITE_PASSWORD must be configured.');process.exit(1);}
const passDigest = createHash('sha256').update(sitePassword).digest();
const maxBytes = 25 * 1024 * 1024;
const typeMap = {'/index.html':'text/html; charset=utf-8','/style.css':'text/css; charset=utf-8','/app.js':'text/javascript; charset=utf-8'};

function send(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function matchesPassword(req){
  const header = req.headers.authorization || '';
  if(!header.startsWith('Basic ') || header.length > 512) return false;
  try{
    const decoded = Buffer.from(header.slice(6),'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if(colon === -1) return false;
    const inputHash = createHash('sha256').update(decoded.slice(colon+1)).digest();
    return timingSafeEqual(inputHash,passDigest);
  }catch{return false;}
}

http.createServer(async (req,res)=>{
  if(req.method === 'GET' && req.url === '/healthz'){
    return send(res,200,{ok:true});
  }
  if(!matchesPassword(req)){
    res.writeHead(401,{
      'WWW-Authenticate':'Basic realm="Shenggao Private Test", charset="UTF-8"',
      'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff'
    });
    res.end('Authentication required');
    return;
  }
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  if(req.method === 'POST' && req.url === '/api/transcribe'){
    const contentType = String(req.headers['content-type'] || '');
    if(!contentType.toLowerCase().startsWith('multipart/form-data;')) return send(res,415,{error:'需要 multipart/form-data 音频上传。'});
    const len = Number(req.headers['content-length'] || 0);
    if(len > maxBytes + 1024*1024) return send(res,413,{error:'文件过大，最大支持约 25 MB。'});
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){
        size += chunk.length;
        if(size > maxBytes + 1024*1024) return send(res,413,{error:'请求过大。'});
        chunks.push(chunk);
      }
      const upload = new Request('http://localhost/upload',{
        method:'POST',headers:{'content-type':contentType},
        body:Buffer.concat(chunks)
      });
      const fields = await upload.formData();
      const key = String(fields.get('api_key') || '').trim();
      const file = fields.get('file');
      if(!key.startsWith('sk-') || !file || typeof file.arrayBuffer !== 'function'){
        return send(res,400,{error:'请输入有效 API Key 并选择音频文件。'});
      }
      if(file.size > maxBytes) return send(res,413,{error:'音频超过 25 MB，请压缩或分段。'});
      const allowed=['.mp3','.mp4','.mpeg','.mpga','.m4a','.wav','.webm','.ogg','.flac'];
      if(!allowed.some(ext=>file.name.toLowerCase().endsWith(ext))) return send(res,400,{error:'不支持此文件格式。'});
      const body=new FormData();
      body.append('file',file,file.name);
      body.append('model','gpt-4o-transcribe');
      const lang = String(fields.get('language') || 'auto');
      if(lang !== 'auto' && ['en','zh','ms'].includes(lang)) body.append('language',lang);
      const prompt = String(fields.get('prompt') || '').slice(0,1200);
      if(prompt) body.append('prompt',prompt);
      const controller = new AbortController();
      const timeout = setTimeout(()=>controller.abort(),300000);
      try{
        const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions',{
          method:'POST',headers:{Authorization:'Bearer '+key},body,signal:controller.signal
        });
        const result = await upstream.json().catch(()=>({error:{message:'API 返回了无法解析的数据。'}}));
        if(!upstream.ok) return send(res,upstream.status,{error:result?.error?.message || '转录失败。'});
        return send(res,200,{text:result.text || ''});
      }finally{clearTimeout(timeout);}
    }catch(error){
      return send(res,error.name === 'AbortError' ? 504 : 500,{
        error:error.name === 'AbortError' ? '转录超时，请稍后重试。' : '服务器处理失败，请检查文件和网络。'
      });
    }
  }
  if(req.method !== 'GET') return send(res,405,{error:'Method not allowed'});
  let requested = String(req.url || '/').split('?')[0];
  if(requested === '/') requested='/index.html';
  if(!(requested in typeMap)) return send(res,404,{error:'Not found'});
  try{
    const bytes=await fs.readFile(path.join(root,requested.slice(1)));
    res.writeHead(200,{'Content-Type':typeMap[requested],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(bytes);
  }catch{return send(res,404,{error:'Not found'});}
}).listen(port,'0.0.0.0',()=>console.log('Shenggao listening on port '+port));