// Task 82: отчёт «Анализ и улучшение 3D-моделей кораблей» (docx).
// Обложка R1 (design-system), палитра DM-1, 3 секции (обложка /
// содержание / тело), Times New Roman (русский), рисунки до/после,
// таблицы аудита и e2e (результаты — из scripts/t82_results.json).
// После генерации: add_toc_placeholders.py --auto, патч футера
// PAGE → arabic, удаление пустых pgNumType, postcheck.py.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, PageNumber, NumberFormat, SectionType,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableOfContents, TableLayoutType,
} = require("docx");
const fs = require("fs");

const RESULTS = JSON.parse(fs.readFileSync("/home/z/my-project/scripts/t82_results.json", "utf8"));

// ── палитра DM-1 (Deep Cyan — tech) из design-system.md ──
const P = {
  bg: "162235", accent: "37DCF2",
  titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078",
  body: "000000", primary: "0A1628", secondary: "5A6570",
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", innerLine: "C8DDE2", surface: "EDF3F5" },
};

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { ...noBorders, insideHorizontal: NB, insideVertical: NB };

// ── заголовок обложки: ширина символа для кириллицы ≈ pt×12 twips ──
function textWidthTw(text, pt) {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const cjk = (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f);
    w += cjk ? pt * 20 : pt * 12;
  }
  return w;
}
function splitTitle(title, maxW, pt) {
  const words = title.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? cur + " " + w : w;
    if (textWidthTw(probe, pt) <= maxW || !cur) cur = probe;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > 1 && lines[lines.length - 1].length <= 4) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}
function calcTitleLayout(title, maxW, preferredPt = 40, minPt = 24) {
  let pt = preferredPt, lines;
  while (pt >= minPt) {
    lines = splitTitle(title, maxW, pt);
    if (lines.length <= 3) break;
    pt -= 2;
  }
  return { titlePt: pt, titleLines: lines };
}
function calcCoverSpacing(prm) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 400, pageHeight = 16838 } = prm;
  const SAFETY = 1200;
  const usable = pageHeight - SAFETY;
  const content = titleLineCount * (titlePt * 23 + 200)
    + (hasSubtitle ? 12 * 23 + 600 : 0) + (hasEnglishLabel ? 9 * 23 + 600 : 0)
    + metaLineCount * (10 * 23 + 100) + fixedHeight + 3 * 300;
  const remaining = Math.max(usable - content, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(remaining * 0.45);
  const rawBottom = Math.floor(remaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, bottomSpacing };
}

// ── обложка R1 (Pure Paragraph Left) ──
function buildCoverR1(cfg) {
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(cfg.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const sp = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!cfg.subtitle, hasEnglishLabel: !!cfg.englishLabel,
    metaLineCount: (cfg.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const ch = [];
  ch.push(new Paragraph({ spacing: { before: sp.topSpacing } }));
  ch.push(new Paragraph({
    indent: { left: padL, right: padR }, spacing: { after: 500 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
    children: [new TextRun({ text: cfg.englishLabel.split("").join("  "), size: 18, color: P.accent, font: { ascii: "Arial" }, characterSpacing: 40 })],
  }));
  titleLines.forEach((line, i) => ch.push(new Paragraph({
    indent: { left: padL },
    spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
    children: [new TextRun({ text: line, size: titleSize, bold: true, color: P.titleColor, font: { ascii: "Arial", eastAsia: "Arial" } })],
  })));
  ch.push(new Paragraph({
    indent: { left: padL }, spacing: { after: 800 },
    children: [new TextRun({ text: cfg.subtitle, size: 24, color: P.subtitleColor, font: { ascii: "Arial", eastAsia: "Arial" } })],
  }));
  for (const line of cfg.metaLines) {
    ch.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 }, border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.metaColor, font: { ascii: "Arial", eastAsia: "Arial" } })],
    }));
  }
  ch.push(new Paragraph({ spacing: { before: sp.bottomSpacing } }));
  ch.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: cfg.footerLeft, size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: cfg.footerRight, size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED, borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children: ch,
      })],
    })],
  })];
}

// ── строительные блоки тела ──
const F = { ascii: "Times New Roman", eastAsia: "Times New Roman" };
const FH = { ascii: "Times New Roman", eastAsia: "Times New Roman" };
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary, font: FH })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: P.primary, font: FH })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: [new TextRun({ text, size: 24, color: P.body, font: F, ...opts })],
  });
}
// абзац с выделенными фрагментами: [текст, жирный?]
function bodyRuns(parts) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: parts.map(([t, b]) => new TextRun({ text: t, bold: !!b, size: 24, color: P.body, font: F })),
  });
}
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 60, after: 240, line: 312 },
    children: [new TextRun({ text, size: 21, color: P.secondary, font: F })],
  });
}
function figure(path, wPx, hPx, cap) {
  const displayWidth = 580;
  const displayHeight = Math.round(displayWidth * hPx / wPx);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 160, after: 40 },
      children: [new ImageRun({ data: fs.readFileSync(path), transformation: { width: displayWidth, height: displayHeight }, type: "jpg" })],
    }),
    caption(cap),
  ];
}
function cell(text, { header = false, w = 25, align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    shading: header ? { type: ShadingType.CLEAR, fill: P.table.headerBg } : undefined,
    children: [new Paragraph({
      alignment: align, spacing: { line: 276 },
      children: [new TextRun({ text, bold: header, size: 21, color: header ? P.table.headerText : P.body, font: F })],
    })],
  });
}
function table(headers, rows, widths, cap) {
  const tbl = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.headerBg },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.headerBg },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => cell(t, { header: true, w: widths[i] })),
      }),
      ...rows.map(r => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => cell(String(t), { w: widths[i] })),
      })),
    ],
  });
  return [
    new Paragraph({
      keepNext: true, spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: cap, bold: true, size: 21, color: P.primary, font: F })],
    }),
    tbl,
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  ];
}

const IMG = "/home/z/my-project/download/task82";
const A = `${IMG}/after`;
const B = `${IMG}/before`;

// ── содержимое тела ──
const bodyChildren = [];

bodyChildren.push(h1("1. Резюме"));
bodyChildren.push(body("Работа выполнена по запросу «проанализируй проект и улучши все 3D-модели: детализация, натуральность, шейдеры — правдоподобные паруса, такелаж, бортики, доски, текстурирование». Все модели игры процедурные (three.js), внешних ассетов нет, поэтому улучшения вносились в генераторы геометрии и шейдеры: plankHull.ts (дощатая обшивка, палуба, каркас), buildShip.ts (рангоут, паруса, такелаж, обводы), woodShader.ts (процедурная древесина и окраска)."));
bodyChildren.push(bodyRuns([
  ["Проверка велась тремя независимыми контурами: числовой лучевой аудит геометрии (три семейства лучей на четырёх пресетах судов), экспертная оценка VLM по контактным листам «до/после» и e2e-регрессии игрового клиента. Итог по геометрии: ", false],
  ["0 сквозных щелей и 0 выступов кромки настила за обвод корпуса на всех четырёх пресетах (шлюп, флейт, галеон, пинасс)", true],
  [" при суммарно 16 452 лучах. Выступ кромки настила устранён полностью: 0,113 м до правки, 0,000 м после.", false],
]));
bodyChildren.push(bodyRuns([
  ["Паруса получили процедурную ткань (полотнища, риф-банты, кромка, погодные пятна, плетение) и эффект просвета против солнца; оценка VLM выросла с 4/10 до 6/10, устранён давний баг рассогласования локальной нормали и мирового направления света. Такелаж дополнен объёмными тросами, обрывающимися вместе с мачтой. Регрессии: новая e2e_v82 — 15/15 ALL OK; v65, v67, v80 — ALL OK (22/22).", false],
  [" Бюджет рендера не пострадал: 472 вызова отрисовки, 1,17 млн треугольников, 59 шейдерных программ.", true],
]));

bodyChildren.push(h1("2. Исходное состояние и постановка задачи"));
bodyChildren.push(body("Pirates.SeaWolf — морская песочница на three.js: процедурные парусники XVII века, бой, торговля, экипаж. К началу задачи визуальная сторона моделей страдала семью устойчивыми дефектами, зафиксированными как визуальной проверкой (VLM по скриншотам с фиксированных ракурсов), так и числовым аудитом геометрии:"));
bodyChildren.push(body("Корма: дощатая стена транца стояла на константах −0,470…−0,484·L — на 45–84 см впереди фактического кормового среза гладкого корпуса; между стеной и кормой оставался открытый «чёрный карман» во всю высоту борта. Руль входил в корпус на 0,7 м и торчал сквозь стену плоской плахой, которую VLM описывал как «большой плоский светлый план под кормой». Нос: обшивка обрезалась «плахой» шириной 0,6 м за 78 см до штевня, сам штевень заканчивался на 0,9 высоты планширя и не читался как брус; у пинасса вход в плоский нос имел скачок полуширины 2,3 м на одной шпации. Палуба: кромка настила пробивала борт на 0,113 м («светлые плашки» VLM). Паруса: плоская одноцветная заливка, швы не читались, просвета не было, оценка 4/10. Такелаж: все снасти — линии толщиной 1 пиксель без блика. Окраска: вельс и пояс планширя шли фиксированными горизонтальными полосами и не следовали седловатости борта.Цель работы — устранить эти дефекты, не добавив внешних ассетов и не превысив бюджет рендера."));
bodyChildren.push(...figure(`${B}/t82_before_sheetA.jpg`, 1520, 854, "Рис. 1. Состояние «до»: шлюп с четырёх ракурсов (борта, нос, корма, изометрия) — тупой срез носа, карман у транца, монотонный верх борта"));

bodyChildren.push(h1("3. Методика и контуры проверки"));
bodyChildren.push(body("Числовой аудит (scripts/t82_hullaudit.mjs). Лучи Raycaster трёх семейств: (А) горизонтальные лучи снаружи к диаметральной плоскости по сетке (z шаг 0,45 м, y шаг 0,16 м) от кормового среза до штевня — каждое попадание обязано лежать на обшивке не глубже 0,10 м от обвода, иначе щель; (D) лучи из-за кормы вдоль оси Z по сетке (y, x) — попадание обязано лежать у линии стены транца transomZ(y) ± 0,12 м; (E) лучи из-за носа в зоне штевня — поверхность обязана существовать у 0,465L. Дополнительно проверяются вершины настила против обвода на своей высоте и перекрытие верхнего пояса с планширем по девяти шпациям."));
bodyChildren.push(body("Визуальная экспертиза. Контактные листы 2×2 из одиннадцати фиксированных ракурсов (scripts/t82_shots.mjs), включая крупные планы оконечностей и вид с палубы; листы оцениваются VLM-моделью по структурированному промпту (щели, планширь, палуба снаружи, пояса, артефакты — с координатами в долях кадра). Оценка «до» — 5/10 по корпусу и 4/10 по парусам. Игровые регрессии: новая e2e_v82.mjs (15 проверок по всем правкам задачи) плюс ранее созданные e2e_v65/v67/v80/v81/v78/v77, гоняющие обстрелы, ломание мачт и UI. Критерий готовности — 0 щелей в аудите и ALL OK во всех e2e."));

bodyChildren.push(h1("4. Корпус: единая линия кормового среза"));
bodyChildren.push(body("Корневая причина «чёрного кармана» — стена транца ставилась по независимым константам, никак не связанным с фактическим срезом гладкого корпуса. Введена параметрическая линия кормового среза transomZ(P, y): низ стены на 1 см позади среза (стык перекрыт торцом корпуса), верх — свес за корму (0,02·L; у судов с квартердеком 0,012·L — развал кормы). По этой единой линии теперь строятся стена транца, кормовые кромки поясов бортов, кромка настила, кромка квартердека, таффрел и планширь — все элементы сходятся в одну линию без карманов."));
bodyChildren.push(body("Число поясов борта и стены объединено (strakeCount/sternStrakeY): оба делят высоту на одинаковое число поясов от общего веера, поэтому швы стены и бортов сходятся на кормовых углах. Ахтерштевень проложен за стеной параллельно её кормовой грани (постоянный отступ 10 см от transomZ) и больше не прошивает стену насквозь у верхних поясов. Руль перевешен за транец: передняя кромка у линии штевня на высоте верха пера, зазор между транцем и пером закрыт (VLM более не видит «тёмный провал»). Аудит по секции D: 124–204 луча на пресет, промахов 0 на всех четырёх пресетах."));
bodyChildren.push(body("Таффрел стал широкой кормовой балкой (0,42 м по длине судна), планширь борта начинается на 10 см впереди линии верха стены и уходит в её торец — у кормы больше нет участков борта без планширя."));

bodyChildren.push(h1("5. Корпус: нос сведён к штевню"));
bodyChildren.push(body("Причина «плахи» — ограничение ширины пояса на носу: clamp max(hw, 0,30) не давал обшивке сузиться сильнее 30 см, поэтому за 0,78 м до штевня борта обрывались плахой. clamp снижен до 0,06 м, пояса доведены до 0,495·L, а их торцы прячутся под новый форштевень — брус сечением 0,38 м от киля до головы на 0,35 м выше планширя, окрашенный светлее борта, чтобы штевень читался как отдельный timber. Цикл укладки пояса получил короткий замыкающий пояс: прежний порог прерывания 0,45 м ломал цикл на последнем шаге и оставлял дыру ~0,4 м перед штевнем (зафиксировано аудитом флейта: 14 промахов на z = 0,4775·L); порог снижен до 0,22 м."));
bodyChildren.push(body("Пинасс (плоский нос): жёсткое переключение обвода на шпации t = 0,82 давало скачок полуширины 2,3 м — пояса перерезали угол диагональными досками, и аудит фиксировал попадания на глубине до 1,8 м от обвода. Вход в плоский нос сделан плавным (бленд t = 0,74–0,82, та же кривая в аудите): глубина провисания хорд упала до 0,097 м при пороге 0,10. Для закрытия среза плоского носа над нижним поясом добавлена дощатая стена носа buildBowWall (пояса как у транца, z = 0,497·L, неразрушаемая — попадания выше среза уходят в корпус и штевень, как раньше). Шаг досок на кривизне ужат вдвое (maxStep 0,42/0,14), чтобы хорды следовали обводу."));
bodyChildren.push(...figure(`${A}/t82_after6_sheetA.jpg`, 1520, 854, "Рис. 2. Состояние «после»: те же четыре ракурса — штевень читается, корма закрыта, пояса сходятся"));
bodyChildren.push(...figure(`${A}/t82_after6_sheetC.jpg`, 1520, 854, "Рис. 3. Крупные планы «после»: борт, нос, корма, фальшборт изнутри"));

bodyChildren.push(h1("6. Палуба и фальшборт"));
bodyChildren.push(body("«Светлые плашки» на борту — торцы палубных досок, пробивавшие обшивку на 0,113 м. Причина: допуск посадки кромки 0,10 м разрешал отрицательный коэффициент сужения k < 0 — сечение доски «складывалось» и выворачивало кромку наружу; центральная колонка настила к тому же не сужалась с внутренней стороны. Допуск поднят до половины ширины доски (k ≥ 0 гарантирован), а центральная колонка у штевня сужается теперь с обеих сторон по обводу — кромка настила по всей длине лежит на обводе или внутри него: максимальный выступ 0,000 м на всех четырёх пресетах (было 0,113 м)."));
bodyChildren.push(body("Ватервейс — тяжёлая доска вдоль борта поверх настила — подогнан по тону к допускам поясов (0,93–1,07, разброс ≤ 0,16), что вернуло зелёным проверку тона e2e_v67 A4. Планширь по верхней кромке фальшборта проверяется по девяти шпациям от −0,46·L до +0,46·L: перекрытие верхнего пояса с ним всюду положительно (0,046–0,146 м), «щели под планширем» нет."));

bodyChildren.push(h1("7. Паруса: ткань, просвет и корневой баг освещения"));
bodyChildren.push(body("Материал паруса получил процедурную ткань: вертикальные полотнища шириной ~55 см (число швов пропорционально ширине паруса, контраст шва 26%), риф-банты с гребёнкой риф-шкертсов, пришивная кромка (таблица) со строчкой по шкаторине, погодные пятна плесени, грязь у галсового угла, потёки от реи и мелкое плетение ткани, видимое только вблизи (гасится fwidth на дистанции — без муара). Механизмы рифления, «пуза» и пробоин не тронуты: массив uHoles×8 и урон полотна работают как раньше (e2e_v82 B2)."));
bodyChildren.push(bodyRuns([
  ["Найден и устранён давний баг: нормаль «пуза» вычислялась в ЛОКАЛЬНЫХ координатах паруса, а направление солнца передаётся мировое, — при повёрнутом корабле свет падал «не туда», парус висел тёмным силуэтом. Нормаль переводится в мировые координаты матрицей модели (mat3(modelMatrix)).", true],
  [" Заодно освещение заменено на мягкое: обёрнутое рассеяние вместо жёсткой границы света/тени и небесное окружение вместо одного направленного луча.", false],
]));
bodyChildren.push(body("Добавлен эффект просвета: когда солнце за полотном, ткань светится тёплым тоном сквозь волокно; толщина ткани гасит свечение на швах, риф-банах и кромке (утолщённое место просвечивает слабее), пробоины не светятся вовсе. Сетки парусов уплотнены (грот 16×11 = 204 вершины, латинская 14×9, кливер 12×8) — «пузо» и трепет кромок читаются глаже. Оценка VLM: 4/10 → 6/10, «ткань у солнца светлеет и слегка светится», швы и риф-банты читаются на всех ракурсах."));
bodyChildren.push(...figure(`${A}/t82_sail2_sheet.jpg`, 1520, 854, "Рис. 4. Паруса «после»: против света (просвет), крупный план ткани, вид сверху — полотнища, рифы, патина"));

bodyChildren.push(h1("8. Такелаж: объёмные тросы"));
bodyChildren.push(body("Стоячий такелаж (ванты, штаги, бакштаги, фалини с нагельных планок) строился линиями толщиной 1 пиксель — «провода» по оценке VLM. Добавлены объёмные тросы диаметром ~6,6 см: на каждую мачту — один меш, собранный из тех же meta-линий (baked-геометрия, 12 треугольников на снасть, всего 216 треугольников на двухмачтовый шлюп — влияние на бюджет рендера ничтожно). Материал пенькового троса: микрорельеф и блик (roughness 0,55 против прежних «проволочных» линий)."));
bodyChildren.push(body("Разрушаемость сохранена: при переломе мачты обвязка вырождается в точку (как раньше), а меш объёмных тросов этой мачты скрывается вместе с веером вант с выбленками (snapRigging); clearDamage возвращает всё на место. Проверено e2e_v82 C1–C3: мешей по числу мачт, после snapRigging(0) тросы первой мачты спрятаны, после clearDamage видны все."));

bodyChildren.push(h1("9. Шейдер древесины: окраска по седловатости"));
bodyChildren.push(body("Вельс (тяжёлый пояс у кромки настила) и пояс под планширем рисовались фиксированными горизонтальными полосами (y 1,67–3,3 м), которые не следовали подъёму борта к носу и корме: у миделя полоса заливала весь верх борта — «монотонная тёмная масса» без читаемых поясов. В шейдер введена GLSL-аппроксимация седловатости bulwark(t) — та же формула, что в генераторе корпуса, — и обе полосы привязаны к ней: вельс идёт у кромки настила (sheer − 1,35…−0,90), пояс планширя — по верхнему поясу (sheer − 0,42…−0,04)."));
bodyChildren.push(body("Контраст конопаченого паза в крашеной зоне усилен с 12% до 45%, фаска нахлёста поясов — с 16% до 28%: пояса читаются и под краской. Процедурные волокна (applyWoodShader) применены к рангоуту, штурвалу и шпилю — общий проектор по нормали даёт осевое волокно и мачтам, и реям без отдельной настройки осей."));

bodyChildren.push(h1("10. Результаты проверок"));
bodyChildren.push(body("Числовой аудит геометрии выполнен на четырёх пресетах, покрывающих все варианты корпуса: шлюп (без квартердека), флейт (квартердек), галеон (бакштевень, квартердек), пинасс (плоский нос, квартердек). Сводка по семействам лучей и контрольным величинам:"));
bodyChildren.push(...table(
  ["Пресет", "Лучи бортов", "Щели", "Лучи стены", "Промахи", "Лучи носа", "Промахи", "Выступ настила, м"],
  [
    ["sloop", "2952", "0", "124", "0", "144", "0", "0,000"],
    ["fluyt", "4652", "0", "186", "0", "174", "0", "0,000"],
    ["galleon", "4690", "0", "204", "0", "168", "0", "0,000"],
    ["pinnace", "4208", "0", "160", "0", "174", "0", "0,000"],
  ],
  [16, 14, 10, 14, 10, 12, 10, 14],
  "Таблица 1. Лучевой аудит геометрии по пресетам (итог Task 82)"));
bodyChildren.push(body("Игровые регрессии прогнаны на поднятом dev-сервере; каждой правке соответствуют числовые проверки в новой e2e_v82, поведение старых сценариев (обстрел, пробитие, ломание мачт, UI настроек) проверено регрессиями прежних задач:"));
bodyChildren.push(...table(
  ["Регрессия", "Проверок", "Итог", "Комментарий"],
  RESULTS.e2e,
  [30, 14, 16, 40],
  "Таблица 2. e2e-прогоны после правок Task 82"));
bodyChildren.push(body(`Бюджет рендера после всех изменений: ${RESULTS.render.calls} вызовов отрисовки, ${(RESULTS.render.tris / 1e6).toFixed(2)} млн треугольников, ${RESULTS.render.progs} шейдерных программ (было до правок: 462 вызова, 1,16 млн треугольников — рост в пределах 3%).`));
bodyChildren.push(body("Оценки VLM по структурированным промптам: корпус — планширь, таффрел и штевень читаются, сквозных просветов нет (остаточные замечания по «тёмной нише под кормой» сняты переносом руля; отдельные «светлые плашки» опознаны как люк настила и кливер — легитимные объекты, числовой аудит подтверждает отсутствие геометрических дефектов в тех точках); паруса — 4/10 → 6/10, из нерешённого VLM отмечает только динамику ткани в статичных кадрах (трепет в игре есть, но кадры снимались с замороженной симуляцией)."));

bodyChildren.push(h1("11. Выводы и рекомендации"));
bodyChildren.push(body("Все семь исходных дефектов устранены с числовым подтверждением: карман транца и плаха носа закрыты единой линией среза и сведением поясов к штевню, кромка настила не выступает за обвод ни на одном пресете, паруса получили ткань с просветом и корректное освещение, такелаж — объём, окраска — седловатость. Регрессии зелёные, бюджет рендера сохранён. Ключевой методический результат: связка «лучевой аудит + VLM + e2e» позволяет локализовать корневые причины (константа вместо параметра, clamp, отрицательный коэффициент формы, рассогласование систем координат), а не маскировать симптомы."));
bodyChildren.push(body("Рекомендации по дальнейшей работе. Первое: блоки и коуши в точках крепления такелажа и бегучий такелаж (фалы от рей к палубе, шкоты к нокам) — следующий по заметности элемент после объёмных вант. Второе: для VLM-проверок парусов снимать кадры при работающей симуляции либо сериями — трепет и колыхание в статичных кадрах не оцениваются. Третье: у крупных судов (галеон, линейные) добавить окна/галереи транца — сейчас корма больших кораблей монотонна. Чётвертое: включить scripts/t82_hullaudit.mjs в обязательную цепочку после любых правок корпусной геометрии — он ловит щели дешевле, чем визуальная проверка. Пятое: проверить верхнюю панель HUD «Смена квадрата моря», частично перекрывающую мачты (замечание VLM, не входило в задачу)."));

bodyChildren.push(h1("Приложение. Артефакты и состав изменений"));
bodyChildren.push(body("Изменённые файлы: src/game/ship/plankHull.ts (линия transomZ, веер поясов, штевни, палуба, стена носа), src/game/ship/buildShip.ts (обводы, планширь, руль, паруса, такелаж, стена носа), src/game/ship/Ship.ts (обрыв/восстановление объёмных тросов), src/game/ship/woodShader.ts (седловатость, контраст паза). Новые скрипты: scripts/e2e_v82.mjs (15 проверок), scripts/t82_sailshot.mjs (съёмка против света); обновлён scripts/t82_hullaudit.mjs (секции стены и носа)."));
bodyChildren.push(body("Артефакты в download/task82: before/ и after/ — контактные листы и кадры «до/после»; vlm/ — полные протоколы VLM-оценок; e2e/ — логи прогонов; STATUS.md — рабочий журнал задачи. Скриншоты в тексте отчёта: листы 2×2 из этих каталогов (ракурсы фиксированы скриптом съёмки, камера поверх игрового рига, HUD скрыт)."));

// ── документ ──
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };
const pageFooter = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: F })],
  })],
});
const pageHeader = () => new Header({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 0 },
    children: [new TextRun({ text: "Анализ и улучшение 3D-моделей кораблей — Pirates.SeaWolf, Task 82", size: 18, color: "808080", font: F })],
  })],
});

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: F, size: 24, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FH, size: 32, bold: true, color: P.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FH, size: 28, bold: true, color: P.primary },
        paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    { // обложка
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "Анализ и улучшение 3D-моделей кораблей",
        subtitle: "Корпуса, паруса, такелаж и шейдеры: лучевой аудит, корневые причины и правки",
        englishLabel: "PIRATES.SEAWOLF · TASK 82",
        metaLines: [
          "Проект: Pirates.SeaWolf — процедурная морская 3D-игра (three.js)",
          "Объект: визуальная достоверность всех моделей судов",
          "Проверка: 16 452 луча аудита, VLM, e2e-регрессии",
          "Дата: 25 ноября 2026 г.",
        ],
        footerLeft: "Pirates.SeaWolf",
        footerRight: "Task 82 · 2026",
      }),
    },
    { // содержание (римская нумерация)
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Содержание", bold: true, size: 32, font: FH, color: P.primary })],
        }),
        new TableOfContents("Содержание", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Примечание: оглавление построено на кодах полей. После правок обновите номера страниц: щёлкните по оглавлению правой кнопкой и выберите «Обновить поле».",
            italics: true, size: 18, color: "888888", font: F,
          })],
        }),
      ],
    },
    { // тело (арабская нумерация с 1)
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  const out = "/home/z/my-project/download/task82/Отчёт_Task82_3D-модели.docx";
  fs.writeFileSync(out, buf);
  console.log("OK:", out, buf.length, "байт");
});
