// Измерение runtime-геометрии ТРУБЫ на /crew (калибровка Task 77):
// поднимаем трубу, шагаем время и печатаем __crewPose().spyGeo —
// где окуляр, куда смотрит ось, дистанция до головы, скрыта ли сабля.
import { execSync } from 'node:child_process';

const runRaw = (args) => {
  try { return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 300000 }).trim(); }
  catch (e) { return `ERR: ${e.stdout || ''} ${e.stderr || ''}`.trim(); }
};
const run = (args, tries = 6) => {
  let out = runRaw(args);
  for (let i = 0; i < tries && (!out.trim() || out.includes('Resource temporarily unavailable') || out.includes('Cdp command timed out') || out.includes('page_wedged')); i++) {
    execSync('sleep 12');
    out = runRaw(args);
  }
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (js) => run(`eval "${js.replace(/\/\/[^\n]*/g, ' ').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);

runRaw('close');
run('open http://localhost:3000/crew');
await sleep(7000);
for (let i = 0; i < 15; i++) {
  if (ev(`!!window.__crewPose`).includes('true')) break;
  await sleep(2500);
}
ev(`window.__crewSetPose('spyglass')`);
for (let k = 0; k < 20; k++) ev(`window.__crewStep(0.15)`);
const out = ev(`JSON.stringify(window.__crewPose())`);
console.log('SPYPOSE:', out);
runRaw('close');
