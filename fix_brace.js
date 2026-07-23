const fs = require('fs');
const path = r'c:\Users\Rafael\SeaSID\frontend\src\__tests__\AgentFab.test.jsx';
let s = fs.readFileSync(path, 'utf8');
const open = (s.match(/\{/g) || []).length;
const close = (s.match(/\}/g) || []).length;
console.log('open', open, 'close', close);
if (open > close) {
  fs.writeFileSync(path, s + '\n}');
}