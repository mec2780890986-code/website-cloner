const $ = id => document.getElementById(id);
let selected = null;
$('file').addEventListener('change', event => {
  selected = event.target.files[0] || null;
  $('fileName').textContent = selected
    ? selected.name + ' · ' + (selected.size / 1024 / 1024).toFixed(2) + ' MB'
    : '点击选择音频文件';
});
$('start').addEventListener('click', async () => {
  const key = $('key').value.trim();
  if (!selected) { $('status').textContent='请先选择录音文件。'; return; }
  if (selected.size > 25*1024*1024) { $('status').textContent='音频超过 25 MB，请先压缩或分段。'; return; }
  if (!key) { $('status').textContent='请输入 OpenAI API Key。'; return; }
  const body = new FormData();
  body.append('file',selected);
  body.append('api_key',key);
  body.append('language',$('language').value);
  body.append('prompt',$('prompt').value);
  $('start').disabled = true;
  $('status').textContent='正在上传和转录，长录音可能需要数分钟，请保持页面打开。';
  try {
    const response = await fetch('/api/transcribe',{method:'POST',body,cache:'no-store'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
    $('output').value = result.text || '';
    $('result').hidden = false;
    $('status').textContent = '转录完成。';
    $('result').scrollIntoView({behavior:'smooth'});
  } catch (error) {
    $('status').textContent = '转录失败：' + error.message;
  } finally {
    $('start').disabled = false;
  }
});
$('copy').addEventListener('click',async () => {
  try { await navigator.clipboard.writeText($('output').value); $('status').textContent='已复制。'; }
  catch { $('output').select(); $('status').textContent='请手动复制选中的文字。'; }
});
$('download').addEventListener('click',() => {
  const blob = new Blob(['\ufeff' + $('output').value], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = (selected?.name || 'transcript').replace(/\.[^.]+$/,'') + '.txt';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});