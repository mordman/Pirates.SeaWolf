// VLM-верификация Task 15: (1) корма-транец сплошная, (2) корабль
// плывёт ПО поверхности штормовых волн (заезжает на гребень)
import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync } from 'node:fs';

async function ask(zai, file, prompt) {
  const b64 = readFileSync(file).toString('base64');
  const response = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  });
  console.log(`\n===== ${file.split('/').pop()} =====`);
  console.log(response.choices?.[0]?.message?.content ?? JSON.stringify(response).slice(0, 400));
}

async function main() {
  const zai = await ZAI.create();
  const stern = `Кадр морской игры: камера прямо ЗА кормой парусного корабля (вид сзади). Оцени СТРОГО:
1) ТРАНЕЦ: задняя стенка корабля (корма) — это сплошная деревянная поверхность? Или сквозь корму что-то ПРОСВЕЧИВАЕТ (видно палубу изнутри, мачту насквозь, горизонт/небо за кораблём сквозь корпус)?
2) КРАЯ: есть ли дыры/щели в корпусе на корме?
3) ВЕРДИКТ: корма сплошная (да/нет).`;
  const storm = `Кадр морской игры: парусный корабль в штормовом море, камера сбоку. Оцени СТРОГО по пунктам, кратко:
1) ВАТЕРЛИНИЯ: корпус входит в воду по ватерлинию (нормально) или висит НАД водой, или погружён слишком глубоко (палуба у самой воды/под водой)?
2) ГРЕБНИ: проходит ли гребень волны СКВОЗЬ корпус выше ватерлинии (сквозь палубу/борта — это дефект)? Или корпус вскрывает гребень носом/бортом как нож — это нормально в шторм?
3) ПАЛУБА: горизонтальная палуба над водой?
4) ВЕРДИКТ: корабль плывёт ПО поверхности волн (да/нет), посадка естественная для шторма (да/нет)?`;
  await ask(zai, process.argv[2] || '/home/z/my-project/scripts/shots/v32_stern_view.png', stern);
  await ask(zai, process.argv[3] || '/home/z/my-project/scripts/shots/v32_storm_ride.png', storm);
}

main().catch(e => { console.error('VLM fail:', e?.message || e); process.exit(1); });
