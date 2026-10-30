import type { RecommendationResponse } from "./types";

/** Пример ответа для демо-режима (без ключа API). Все произведения реальные. */
export const DEMO_RESPONSE: RecommendationResponse = {
  profile: {
    summary:
      "Вкус держится на меланхолии с привкусом тревоги: вы любите, когда красота слегка повреждена — плёночный шум у Boards of Canada, крэкл у Burial, туман у Grouper. В кино и книгах вас тянет к зонам, где реальность расслаивается: Зона у Тарковского, петля у Линча, пустота у Пелевина. Вы не боитесь медленного темпа и недосказанности, но вам важна атмосфера как самостоятельный герой. Слабое место: почти нет солнечного, лёгкого и ритмичного — это не недостаток, но туда можно заглянуть.",
    axes: [
      { name: "Мрачность", value: 78, note: "Тёмная палитра почти везде, но без агрессии — скорее сумерки, чем ночь." },
      { name: "Текстура важнее мелодии", value: 85, note: "Шум, пространство и запись как объект — это ваш главный критерий." },
      { name: "Медитативный темп", value: 80, note: "Долгие планы, повторы, дроны. Быстрый монтаж и поп-структура редко задерживаются." },
      { name: "Расслоённая реальность", value: 90, note: "Сны, зоны, симуляции — связующая тема всех трёх доменов." },
      { name: "Ирония", value: 45, note: "Пелевин даёт ироничный люфт, но в музыке и кино вы серьёзны." },
    ],
    anchors: ["Warp Records и его ностальгическая ветвь", "Hyperdub / хонтология", "Kranky", "советская и постсоветская фантастика", "Линч как метод"],
    blind_spots: ["Солнечный пост-панк и джангл-поп", "Литература с юмором без метафизики", "Документальное кино"],
    translations: [
      {
        from: "music",
        to: "film",
        statement:
          "Ваша музыка в кино — это медленное фестивальное кино, где саундтрек работает как текстура, а не как мелодия: Глейзер, Стрикленд, поздний Линч, Герман. Burial = ночной город без людей, Boards of Canada = выцветшая плёнка и детство, Grouper = туман и длинный план.",
      },
      {
        from: "music",
        to: "book",
        statement:
          "Ваша музыка в книгах — это проза, где ландшафт переписывает героя, а не наоборот: Вандермеер, Сорокин, эссеистика Марка Фишера про хонтологию. Низкий темп, высокая плотность, ощущение утраченного будущего.",
      },
      {
        from: "film",
        to: "music",
        statement:
          "Ваше кино в музыке — это эмбиент и дроновое техно с крэклом и пустым пространством: Gas = лес Тарковского, Demdike Stare = Линч, Leyland Kirby = Twin Peaks, в котором никого не осталось.",
      },
    ],
  },
  recommendations: [
    {
      domain: "music",
      title: "Sadly, the Future Is No Longer What It Was",
      title_ru: null,
      creator: "Leyland Kirby",
      year: 2009,
      why: "Если Burial — это ночной город после рейва, то Кирби — та же ностальгия, но уже в пустой квартире. Трёхчасовой альбом на собственном лейбле History Always Favours the Winners, основа «хонтологии» — термина, который критик Марк Фишер применял именно к Burial и Boards of Canada. Пространство Grouper здесь тоже угадывается.",
      connections: [
        { type: "scene", text: "Хонтология — та же сцена, что Burial и Boards of Canada" },
        { type: "mood", text: "Ностальгия по будущему, которое не случилось" },
        { type: "label", text: "History Always Favours the Winners — лейбл самого Кирби (он же The Caretaker)" },
      ],
      bridge: {
        from_domain: "music",
        from_items: ["Burial — Untrue", "Boards of Canada — Music Has the Right to Children"],
        analogy: "Это Burial и Boards of Canada, доведённые до предела: та же ностальгия по отменённому будущему, но без бита и без мелодии, только эхо.",
      },
      depth: "deep",
      confidence: 0.86,
    },
    {
      domain: "music",
      title: "Plume",
      title_ru: null,
      creator: "Loscil",
      year: 2006,
      why: "Loscil выходит на Kranky — лейбле, где записывалась и Grouper. Это дроновый эмбиент с подводной плотностью: ритм почти не слышен, но он держит форму. Хорошая пара к Ruins для вечернего прослушивания без слов.",
      connections: [
        { type: "label", text: "Kranky — тот же лейбл, что у Grouper" },
        { type: "style", text: "Дроновый эмбиент с медленным пульсом" },
      ],
      bridge: {
        from_domain: "music",
        from_items: ["Grouper — Ruins"],
        analogy: "Это Grouper без голоса: то же пространство и влажная тишина, но под водой, а не в пустом доме.",
      },
      depth: "deep",
      confidence: 0.84,
    },
    {
      domain: "music",
      title: "Tryptych",
      title_ru: null,
      creator: "Demdike Stare",
      year: 2011,
      why: "Манчестерский дуэт на лейбле Modern Love копает в ту же тьму, что Burial, но через оккультный даб и библиотечную музыку. Это Burial для тех, кто любит ещё и фильмы ужасов 70-х. Собирает три их EP в один долгий сеанс.",
      connections: [
        { type: "label", text: "Modern Love — родной лейбл Andy Stott, сосед Hyperdub по сцене" },
        { type: "mood", text: "Крэкл, туман и тревога как у Burial" },
        { type: "theme", text: "Кино ужасов и оккультизм — мост к Линчу" },
      ],
      bridge: {
        from_domain: "film",
        from_items: ["Lost Highway (1997)", "Twin Peaks: Fire Walk with Me (1992)"],
        analogy: "Это Lost Highway, если бы он был альбомом: коридор, красный свет, кто-то дышит за стеной, и всё это на пластинке с царапинами.",
      },
      depth: "obscure",
      confidence: 0.8,
    },
    {
      domain: "music",
      title: "Pop",
      title_ru: null,
      creator: "Gas",
      year: 2000,
      why: "Вольфганг Фойгт сделал лесной эмбиент-техно, который звучит как Boards of Canada, если убрать мелодии и оставить только дышащую пелену. Классика лейбла Mille Plateaux; лес как Зона у Тарковского — не метафора, а прямой источник образов Фойгта.",
      connections: [
        { type: "style", text: "Эмбиент-техно с туманом, как у BoC без битов" },
        { type: "theme", text: "Лес как пространство транса — родственник Зоны" },
      ],
      bridge: {
        from_domain: "film",
        from_items: ["Сталкер (1979)"],
        analogy: "Это Зона из Сталкера как музыка: лес, в котором пульс слышен сквозь листву, и ничего не происходит, но уйти невозможно.",
      },
      depth: "deep",
      confidence: 0.88,
    },
    {
      domain: "film",
      title: "Berberian Sound Studio",
      title_ru: "Студия звукозаписи «Берберян»",
      creator: "Peter Strickland",
      year: 2012,
      why: "Фильм о звукорежиссёре итальянского хоррора 70-х, где реальность постепенно сливается с монтажной. Саундтрек написала группа Broadcast — соседи Boards of Canada по Warp. Это Линч, увиденный глазами человека, который любит плёночный шум.",
      connections: [
        { type: "label", text: "Саундтрек Broadcast — Warp Records, как Boards of Canada" },
        { type: "theme", text: "Расслоение реальности через звук — родственник Lost Highway" },
      ],
      bridge: {
        from_domain: "music",
        from_items: ["Boards of Canada — Music Has the Right to Children", "Portishead — Third"],
        analogy: "Это Boards of Canada, если бы они были фильмом: аналоговый шум, плёнка 70-х, детский страх и ощущение, что запись помнит больше, чем ты.",
      },
      depth: "deep",
      confidence: 0.87,
    },
    {
      domain: "film",
      title: "Under the Skin",
      title_ru: "Побудь в моей шкуре",
      creator: "Jonathan Glazer",
      year: 2013,
      why: "Медленный, почти бессловесный фильм с музыкой Mica Levi, которая работает как дрон Grouper на экране. Чужое существо в Глазго — Солярис, перевёрнутый наизнанку: не мы изучаем иное, а оно нас.",
      connections: [
        { type: "musician", text: "Саундтрек Mica Levi — текстурный, как ваша музыка" },
        { type: "theme", text: "Иное, которое смотрит на человека — перекличка с Лемом" },
      ],
      bridge: {
        from_domain: "music",
        from_items: ["Grouper — Ruins", "Burial — Untrue"],
        analogy: "Это Grouper и Burial в одном кадре: ночной Глазго под дроновым саундтреком, где человек — самый чужой объект в кадре.",
      },
      depth: "entry",
      confidence: 0.85,
    },
    {
      domain: "film",
      title: "Трудно быть богом",
      title_ru: "Трудно быть богом",
      creator: "Алексей Герман",
      year: 2013,
      why: "Если Зона Тарковского — это Стругацкие, очищенные до молитвы, то Герман — те же Стругацкие, утопленные в грязи. Трёхчасовое чёрно-белое погружение без выхода. Тяжело, но для вашего профиля это следующая ступень после Сталкера.",
      connections: [
        { type: "adaptation", text: "Стругацкие — те же авторы, что стоят за Сталкером" },
        { type: "era", text: "Поздний советский и постсоветский канон" },
      ],
      bridge: {
        from_domain: "book",
        from_items: ["Станислав Лем — Солярис", "Виктор Пелевин — Чапаев и Пустота"],
        analogy: "Это Лем и Пелевин, если бы их сняли на чёрно-белую плёнку и утопили в грязи: наблюдатель внутри чужого мира, который не может ни вмешаться, ни уйти.",
      },
      depth: "deep",
      confidence: 0.82,
    },
    {
      domain: "book",
      title: "Ghosts of My Life",
      title_ru: "Призраки моей жизни",
      creator: "Mark Fisher",
      year: 2014,
      why: "Книга, в которой Burial и Boards of Canada описаны как одно явление — хонтология, тоска по отменённому будущему. Фишер пишет и о Линче, и о британском телевидении, из которого выросла эстетика Warp. Это карта вашего собственного вкуса, написанная кем-то другим.",
      connections: [
        { type: "theme", text: "Прямо разбирает Burial и Boards of Canada" },
        { type: "scene", text: "Хонтология как культурный термин" },
      ],
      bridge: {
        from_domain: "music",
        from_items: ["Burial — Untrue", "Boards of Canada — Music Has the Right to Children"],
        analogy: "Это Burial и Boards of Canada как книга: не метафора, а буквально — Фишер разбирает именно эти записи и объясняет, почему они звучат как утраченное будущее.",
      },
      depth: "deep",
      confidence: 0.9,
    },
    {
      domain: "book",
      title: "Annihilation",
      title_ru: "Аннигиляция",
      creator: "Jeff VanderMeer",
      year: 2014,
      why: "Зона Х — прямое наследие Зоны Стругацких и Тарковского, но с биологическим телом вместо метафизики. Экспедиция, дневник, ландшафт, который переписывает людей. Читать как медленный эмбиент.",
      connections: [
        { type: "influence", text: "Явный наследник «Пикника на обочине» и Сталкера" },
        { type: "mood", text: "Тревожная красота, как у Grouper" },
      ],
      bridge: {
        from_domain: "film",
        from_items: ["Сталкер (1979)"],
        analogy: "Это Сталкер, если бы его написали сегодня как роман: Зона, экспедиция, дневник и ландшафт, который переписывает тех, кто в него вошёл.",
      },
      depth: "entry",
      confidence: 0.88,
    },
    {
      domain: "book",
      title: "Метель",
      title_ru: "Метель",
      creator: "Владимир Сорокин",
      year: 2010,
      why: "Повесть, где русская классика XIX века встречает фантастику: доктор едет через метель на малых лошадях и не доезжает. Если Пелевин работает с пустотой через иронию, Сорокин — через стиль и ландшафт. Короткая, плотная, оставляет послевкусие как альбом Grouper.",
      connections: [
        { type: "scene", text: "Постсоветская метафизическая проза рядом с Пелевиным" },
        { type: "mood", text: "Снег, безвыходность, транс" },
      ],
      bridge: {
        from_domain: "music",
        from_items: ["Grouper — Ruins"],
        analogy: "Это Grouper как русская проза: снег вместо тумана, дорога, которая никуда не ведёт, и красота, от которой холодно.",
      },
      depth: "deep",
      confidence: 0.83,
    },
  ],
};
