(function (root, factory) {
  const content = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = content;
  root.RUNECHAIN_CONTENT = content;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
const ECON = {
  GOLD_PER_RUNE:1,
  GOLD_PER_SOL:1000,
  SPLIT:{burn:0.50,marketing:0.35,ops:0.15},
  BURN_ADDR:'BURN', MARKETING_ADDR:'MARKETING', OPS_ADDR:'OPS', EXCHANGE_ADDR:'EXCHANGE'
};

const ENEMY_REWARDS = {
  hollow:{name:'Hollow Debtor', rune:14},
  hound:{name:'Red Hound', rune:16},
  knight:{name:'Fallen Knight', rune:26},
  sorcerer:{name:'Hollow Sorcerer', rune:30},
  'flying-eye':{name:'Ledger Eye', rune:20},
  mushroom:{name:'Spore Debtor', rune:18},
  sexton:{name:'Gate Sexton Marrow', rune:34},
  mempool:{name:'Mempool Warden', rune:42},
  tallow:{name:'Mother Tallow', rune:100},
  foreman:{name:'The Debt Foreman', rune:68},
  bifurcated:{name:'Bifurcated Guard', rune:58},
  ledgerbound:{name:'The Ledger-Bound', rune:160},
  scrivener:{name:'The Scrivener', rune:88},
  cascade:{name:'Cascade Anchor', rune:108},
  auditor:{name:'The Auditor', rune:300}
};

const STORY = root.RUNECHAIN_STORY || {
  version:1,
  startQuest:'q01',
  quests:[{
    id:'q01',
    title:'Hearthlight Chapel',
    onStart:['You wake beneath a warm ledger-lamp. The chapel floor has already recorded your name.'],
    steps:[
      {id:'registry', text:'Touch the Hearthlight registry stone.', done:{event:'interact', target:'hearth-registry', count:1}},
      {id:'first-debt', text:'Step beyond Hearthlight and cut down the first Hollow Debtor.', done:{event:'kill', monster:'hollow', count:1}}
    ],
    onComplete:['The Hollow collapses into ledger ash. Something below the parish records the debt.'],
    rewards:{rune:8},
    next:'q02'
  },{
    id:'q02',
    title:'Parish Road Receipts',
    onStart:['The road east is paved with unpaid vows and walking receipts. Two bells decide what counts.'],
    steps:[
      {id:'bells', text:'Ring 2 verification bells beside the parish road.', done:{event:'interact', target:'verification-bell', count:2}},
      {id:'debtors', text:'Clear 2 more Hollow Debtors from the road receipts.', done:{event:'kill', monster:'hollow', count:2}},
      {id:'sexton', text:'Defeat Gate Sexton Marrow before he stamps your name shut.', done:{event:'kill', monster:'sexton', count:1}}
    ],
    onComplete:['The bells agree. The Chainwell below the chapel accepts your first proof.'],
    rewards:{rune:18},
    next:'q03'
  },{
    id:'q03',
    title:'Chainwell Ledger',
    onStart:['A dead ledger turns below the chapel stones. It wants proof, not prayer.'],
    steps:[
      {id:'first-relic', text:'Forge your first RUNE relic at Hearthlight.', done:{event:'forge', any:true}}
    ],
    onComplete:['The relic bites into your hand. The Chainwell writes you as the Recorded, not the chosen.'],
    rewards:{rune:12},
    next:'q04'
  },{
    id:'q04',
    title:'The Mempool Yard',
    onStart:['Petitioners circle the yard, each waiting to be confirmed into a worse shape.'],
    steps:[
      {id:'yard-debtors', text:'Clear 2 pending Hollow Debtors from the Mempool Yard.', done:{event:'kill', monster:'hollow', count:2}},
      {id:'tablets', text:'Stamp 3 pending tablets in ledger order.', done:{event:'interact', target:'pending-tablet', count:3}},
      {id:'warden', text:'Defeat the Mempool Warden before the queue overflows.', done:{event:'kill', monster:'mempool', count:1}}
    ],
    onComplete:['The pending dead finally settle. Something waxen wakes inside Tallow House.'],
    rewards:{rune:24},
    next:'q05'
  },{
    id:'q05',
    title:'Tallow House',
    onStart:['Candles burn with names instead of wax. Some names are still screaming.'],
    steps:[
      {id:'candles', text:'Extinguish 3 duplicate Tallow candles and leave the canonical flame lit.', done:{event:'interact', target:'tallow-candle', count:3}},
      {id:'mother-tallow', text:'Defeat Mother Tallow and claim the first Boss Sigil.', done:{event:'kill', monster:'tallow', count:1}}
    ],
    onComplete:['Mother Tallow melts into a sealed sigil. Gracefall has its first hard proof. A cold light breaks through the northern floor.'],
    rewards:{rune:40},
    next:'q06'
  },{
    id:'q06',
    title:'Vault Anteroom',
    onStart:['The Shroud Vaults open northward. Crystallized ledger-stone hums with inherited debt.'],
    steps:[
      {id:'lectern', text:'Read the ancestor-chain lectern in the Vault Anteroom.', done:{event:'interact', target:'ancestor-lectern', count:1}}
    ],
    /* The Keeper of Margins (margin-scroll) is a canonical OPTIONAL side-interaction, not a
       required q06 step: re-inscribing her entry weakens the Debt Foreman (two difficulty
       states). See index.html interactableActive/startBossEncounter (predicate 'q06:margin-scroll'). */
    onComplete:['The anteroom records your descent. The shaft below splits Canon from Schism.'],
    rewards:{rune:28},
    next:'q07'
  },{
    id:'q07',
    title:'The Debt Mines',
    onStart:['The shaft descends through crystallized names. Canon left, Schism right — both roads lead down.'],
    steps:[
      {id:'mine-hollows', text:'Clear 3 Hollow Inheritors from the Debt Mines.', done:{event:'kill', monster:'hollow', count:3}},
      {id:'foreman', text:'Defeat the Debt Foreman before the shaft collapses.', done:{event:'kill', monster:'foreman', count:1}}
    ],
    onComplete:["The Foreman's ledger-stamp shatters. An ancestor's name surfaces from the rubble."],
    rewards:{rune:52},
    next:'q08'
  },{
    id:'q08',
    title:'The Ledger Vaults',
    onStart:['Family vault doors line the walls. The living floor scrolls names — yours included.'],
    steps:[
      {id:'vault-seals', text:'Break 2 contested vault seals to free the pending records.', done:{event:'interact', target:'vault-seal', count:2}},
      {id:'bifurcated', text:'Defeat the Bifurcated Guard — both halves must fall.', done:{event:'kill', monster:'bifurcated', count:1}}
    ],
    onComplete:["The Guard's amber and green chains unravel. The Contested Key drops."],
    rewards:{rune:72},
    next:'q09'
  },{
    id:'q09',
    title:'The Ledger-Bound',
    onStart:['The colossal golem of crystallized ancestral names stirs. Your record compounds against you.'],
    steps:[
      {id:'ledgerbound', text:'Fracture the Ledger-Bound and sever your name from the ancestral chain.', done:{event:'kill', monster:'ledgerbound', count:1}}
    ],
    onComplete:['The golem fractures. Your name contests its inheritance — and wins. The Contested Will is yours. The Ascent of Testimony opens above.'],
    rewards:{rune:120},
    next:'q10'
  },{
    id:'q10',
    title:'Archive Tower',
    onStart:['The Archive Tower rewrites you in real time. The ledger-desk already has your entry.'],
    steps:[
      {id:'reading-desk', text:'Let the archive reading-desk write your name in its current form.', done:{event:'interact', target:'reading-desk', count:1}},
      {id:'void-seals', text:'Stabilize 2 Void Seals before the hyperinflation tick corrupts them.', done:{event:'interact', target:'void-seal', count:2}}
    ],
    onComplete:["The Prime Witness stirs. She has seen every record since the first. She confirms your paradox."],
    rewards:{rune:48},
    next:'q11'
  },{
    id:'q11',
    title:'Ascent of Testimony',
    onStart:['The Ascent climbs and contradicts itself. Midway — you fall up.'],
    steps:[
      {id:'audit-wolves', text:'Outrun 3 Audit Wolf packs on the Ascent of Testimony.', done:{event:'kill', monster:'hollow', count:3}},
      {id:'scrivener', text:'Defeat the Scrivener before your stat-sheet is fully greyed.', done:{event:'kill', monster:'scrivener', count:1}}
    ],
    onComplete:['The Scrivener falls. Write-access is yours. The Scrivener\'s Quill drops.'],
    rewards:{rune:80},
    next:'q12'
  },{
    id:'q12',
    title:'Seized Asset Yard',
    onStart:['Your own repossessed relics patrol as husks. The arena overlaps three zones at once.'],
    steps:[
      {id:'ledger-cores', text:'Interact with 2 core ledgers to stabilize your record.', done:{event:'interact', target:'ledger-core', count:2}},
      {id:'cascade', text:'Contest 3 consecutive decrees from the Cascade Anchor to destabilize it.', done:{event:'kill', monster:'cascade', count:1}}
    ],
    onComplete:["The Cascade Anchor retreats. The Auditor isn't evil — only consistent. The paradox is your own."],
    rewards:{rune:100},
    next:'q13'
  },{
    id:'q13',
    title:'The Auditor',
    onStart:['The humanoid silhouette of scrolling text faces you. It cannot be killed. Only answered.'],
    steps:[
      {id:'auditor', text:'Stand your ground against the Auditor and make your choice.', done:{event:'kill', monster:'auditor', count:1}}
    ],
    onComplete:['The ledger rotates one final time. Your amendment stands. You are the Second Scribe.'],
    rewards:{rune:200}
  }]
};

const RELICS = [
  {id:'ember-edge', name:'Ember Edge', price:18, desc:'+8 attack damage. First real upgrade.', dmg:8, icon:'relic-ember-edge'},
  {id:'warden-sigil', name:'Warden Sigil', price:28, desc:'+18 max health. Survive a mistake.', hp:18, icon:'relic-warden-sigil'},
  {id:'green-knot', name:'Green Knot', price:34, desc:'+16 max stamina. Dash and swing longer.', sta:16, icon:'relic-green-knot'},
  {id:'rune-lens', name:'Rune Lens', price:48, desc:'+20% RUNE bounty from kills.', runeMult:0.2, icon:'relic-rune-lens'},
  {id:'tallow-brand', name:'Tallow Brand', price:90, desc:'+18 attack and +25 health.', dmg:18, hp:25, icon:'relic-tallow-brand'}
];
/* Boss Sigils — unique on-chain final-boss drops. RATIFIED RULINGS (docs/design/DESIGN-BIBLE.md):
   sigils grant RUNE-ACQUISITION bonuses earned by boss kills (grind-gated), never purchasable power.
   RUNE buys power ONLY at a Hearthlight; Gold is cosmetics only; endgame loops grant no farmable power. */
/* Hearthlight leveling — the ONLY RUNE power-sink besides relic forging (DESIGN-BIBLE Ruling 1).
   A stat's level is derived from accepted spend blocks on the ledger; cost rises with each level so
   power stays grind-gated. Authoritative cost math lives here so client and server agree exactly. */
const LEVELING = {
  baseCost: 12,
  growth: 8,
  maxLevel: 20,
  stats: {
    vigor:     { name:'Vigor',     grants:'+12 max health',  hp:12 },
    endurance: { name:'Endurance', grants:'+10 max stamina', sta:10 },
    strength:  { name:'Strength',  grants:'+4 attack',       dmg:4 },
  },
  // Cost to buy the (level -> level+1) upgrade, where `level` is the current count of that stat.
  costFor(level) { return this.baseCost + this.growth * level; },
};
const SIGILS = {
  'waxen-testament': { name:'The Waxen Testament', runeMult:0.12, note:'Legitimately Recorded' },
  'contested-will':  { name:'The Contested Will', runeMult:0.10, atkSpeed:0.12, iframeOnHit:true, note:'Severed from inheritance' },
  'amended-record':  { name:'The Amended Record', runeMult:0.15, endgame:true, note:'Co-authored' }
};

const SKINS = [
  { id:'tarnished', name:'Recorded', price:0, body:'#334052', trim:'#8ca0b8', skin:'#cfa982' },
  { id:'crimson', name:'Crimson Lord', price:120, body:'#6b2020', trim:'#e24a4a', skin:'#cfa982' },
  { id:'verdant', name:'Verdant Knight', price:180, body:'#1f472f', trim:'#57c77a', skin:'#cfa982' },
  { id:'azure', name:'Azure Witness', price:240, body:'#233d73', trim:'#7aa7ff', skin:'#cfa982' },
  { id:'gilded', name:'Gilded Champion', price:500, body:'#4d3c17', trim:'#f1c75b', skin:'#d5c596' },
  { id:'void', name:'Voidwalker', price:800, body:'#17141f', trim:'#9b74ff', skin:'#77718f' }
];

const ASSETS={
  tiles:{src:'assets/pixel/tiles-parish.png',w:16,h:16,img:null},
  playerDir:{src:'assets/pixel/player-directions.png',w:56,h:56,img:null},
  heroKnightDir:{src:'assets/pixel/hero-knight-directions.png',w:54,h:44,img:null},
  heroKnightAtk:{src:'assets/pixel/hero-knight-attack.png',w:54,h:44,img:null},
  player:{src:'assets/pixel/player.png',w:24,h:24,img:null},
  'free-knight-idle':{src:'assets/pixel/free-knight-idle.png',w:120,h:80,img:null},
  'free-knight-run':{src:'assets/pixel/free-knight-run.png',w:120,h:80,img:null},
  'free-knight-jump':{src:'assets/pixel/free-knight-jump.png',w:120,h:80,img:null},
  'free-knight-fall':{src:'assets/pixel/free-knight-fall.png',w:120,h:80,img:null},
  'free-knight-attack':{src:'assets/pixel/free-knight-attack.png',w:120,h:80,img:null},
  'free-knight-hit':{src:'assets/pixel/free-knight-hit.png',w:120,h:80,img:null},
  'free-knight-death':{src:'assets/pixel/free-knight-death.png',w:120,h:80,img:null},
  hollow:{src:'assets/pixel/hollow.png',w:24,h:24,img:null},
  hound:{src:'assets/pixel/hound.png',w:24,h:24,img:null},
  knight:{src:'assets/pixel/knight.png',w:24,h:24,img:null},
  sorcerer:{src:'assets/pixel/sorcerer.png',w:24,h:24,img:null},
  sexton:{src:'assets/pixel/sexton.png',w:56,h:56,img:null},
  tallow:{src:'assets/pixel/tallow.png',w:64,h:64,img:null},
  sentinel:{src:'assets/pixel/sentinel.png',w:48,h:48,img:null},
  phantom:{src:'assets/pixel/phantom.png',w:24,h:24,img:null},
  mempool:{src:'assets/pixel/mempool.png',w:56,h:56,img:null},
  'tallow-echo':{src:'assets/pixel/tallow-echo.png',w:24,h:24,img:null},
  foreman:{src:'assets/pixel/foreman.png',w:64,h:64,img:null},
  bifurcated:{src:'assets/pixel/bifurcated.png',w:56,h:56,img:null},
  ledgerbound:{src:'assets/pixel/ledgerbound.png',w:80,h:80,img:null},
  'hollow-ancestor':{src:'assets/pixel/hollow-ancestor.png',w:24,h:24,img:null},
  'canon-auditor':{src:'assets/pixel/canon-auditor.png',w:24,h:24,img:null},
  'schism-shadow':{src:'assets/pixel/schism-shadow.png',w:24,h:24,img:null},
  scrivener:{src:'assets/pixel/scrivener.png',w:64,h:64,img:null},
  cascade:{src:'assets/pixel/cascade.png',w:72,h:72,img:null},
  auditor:{src:'assets/pixel/auditor.png',w:80,h:80,img:null},
  'audit-wolf':{src:'assets/pixel/audit-wolf.png',w:32,h:32,img:null},
  'relic-shade':{src:'assets/pixel/relic-shade.png',w:24,h:24,img:null},
  'flying-eye':{src:'assets/pixel/flying-eye.png',w:24,h:24,img:null},
  mushroom:{src:'assets/pixel/mushroom.png',w:24,h:24,img:null},
  'pf-flying-eye':{src:'assets/pixel/pf-flying-eye.png',w:64,h:64,img:null},
  'pf-goblin':{src:'assets/pixel/pf-goblin.png',w:64,h:64,img:null},
  'pf-mushroom':{src:'assets/pixel/pf-mushroom.png',w:64,h:64,img:null},
  'pf-skeleton':{src:'assets/pixel/pf-skeleton.png',w:64,h:64,img:null},
  'pf-flying-eye-projectile':{src:'assets/pixel/pf-flying-eye-projectile.png',w:48,h:48,img:null},
  'pf-goblin-bomb':{src:'assets/pixel/pf-goblin-bomb.png',w:100,h:100,img:null},
  'pf-mushroom-projectile':{src:'assets/pixel/pf-mushroom-projectile.png',w:50,h:50,img:null},
  'pf-skeleton-sword':{src:'assets/pixel/pf-skeleton-sword.png',w:92,h:102,img:null},
  'relic-ember-edge':{src:'assets/pixel/relic-ember-edge.png',w:16,h:16,img:null},
  'relic-warden-sigil':{src:'assets/pixel/relic-warden-sigil.png',w:16,h:16,img:null},
  'relic-green-knot':{src:'assets/pixel/relic-green-knot.png',w:16,h:16,img:null},
  'relic-rune-lens':{src:'assets/pixel/relic-rune-lens.png',w:16,h:16,img:null},
  'relic-tallow-brand':{src:'assets/pixel/relic-tallow-brand.png',w:16,h:16,img:null},
  'gl-terrain':{src:'assets/pixel/gl-terrain.png',w:192,h:64,img:null},
  'gl-bg1':{src:'assets/pixel/gl-bg1.png',w:368,h:208,img:null},
  'gl-bg2':{src:'assets/pixel/gl-bg2.png',w:400,h:208,img:null},
  'gl-bg3':{src:'assets/pixel/gl-bg3.png',w:416,h:208,img:null},
  'gl-cloud1':{src:'assets/pixel/gl-cloud1.png',w:48,h:16,img:null},
  'gl-cloud2':{src:'assets/pixel/gl-cloud2.png',w:64,h:32,img:null},
  'gl-cloud3':{src:'assets/pixel/gl-cloud3.png',w:96,h:32,img:null},
  'gl-tree':{src:'assets/pixel/gl-tree.png',w:64,h:80,img:null},
  'gl-bush':{src:'assets/pixel/gl-bush.png',w:16,h:16,img:null},
  'gl-stone':{src:'assets/pixel/gl-stone.png',w:16,h:16,img:null},
  'gl-tallgrass1':{src:'assets/pixel/gl-tallgrass1.png',w:16,h:16,img:null},
  'gl-tallgrass2':{src:'assets/pixel/gl-tallgrass2.png',w:16,h:16,img:null},
  'gl-stone2':{src:'assets/pixel/gl-stone2.png',w:16,h:16,img:null},
  'gl-stone3':{src:'assets/pixel/gl-stone3.png',w:32,h:16,img:null},
  'gl-choppedtree':{src:'assets/pixel/gl-choppedtree.png',w:32,h:16,img:null}
};

const PLAT_LEVEL={id:'a1-parish-road',name:'Parish Road Receipts',width:2000,height:640,
  spawn:{x:80,y:530},physics:{maxRun:220,jump:455},
  tilesheet:'gl-terrain',
  bg:['gl-bg1','gl-bg2','gl-bg3'],bgParallax:[0.08,0.2,0.42],
  clouds:[
    {key:'gl-cloud1',x:120,y:32,parallax:0.04},{key:'gl-cloud2',x:340,y:20,parallax:0.06},
    {key:'gl-cloud3',x:620,y:40,parallax:0.05},{key:'gl-cloud1',x:900,y:24,parallax:0.04},
    {key:'gl-cloud2',x:1180,y:36,parallax:0.06},{key:'gl-cloud3',x:1520,y:18,parallax:0.05}
  ],
  props:[
    {key:'gl-tree',x:48,y:560},{key:'gl-bush',x:160,y:560},{key:'gl-stone',x:400,y:560},
    {key:'gl-tree',x:580,y:560},{key:'gl-bush',x:720,y:560},{key:'gl-stone',x:876,y:560},
    {key:'gl-tree',x:1168,y:496},{key:'gl-bush',x:1440,y:496},{key:'gl-tree',x:1760,y:336}
  ],
  platforms:[
    {id:'ground-a',x:0,y:560,w:512,h:80},
    {id:'shelf-a',x:80,y:496,w:96,h:16,type:'oneWay'},
    {id:'ledge-a',x:224,y:432,w:80,h:16,type:'oneWay'},
    {id:'scout-post',x:336,y:368,w:64,h:16,type:'oneWay'},
    {id:'mover-a',x:462,y:512,w:80,h:16,type:'solid',vx:36,minX:444,maxX:596},
    {id:'island-a',x:544,y:560,w:200,h:80},
    {id:'upper-a',x:576,y:496,w:112,h:16,type:'oneWay'},
    {id:'island-b',x:792,y:560,w:236,h:80},
    {id:'step-b',x:840,y:496,w:80,h:16,type:'oneWay'},
    {id:'bridge-c',x:972,y:528,w:64,h:16,type:'oneWay'},
    {id:'bridge-d',x:1020,y:480,w:64,h:16,type:'oneWay'},
    {id:'raised-c',x:1056,y:496,w:688,h:144},
    {id:'wall-c',x:1264,y:448,w:72,h:48},
    {id:'ledge-c',x:1376,y:432,w:112,h:16,type:'oneWay'},
    {id:'mover-b',x:1472,y:451,w:72,h:16,type:'solid',vy:-40,minY:392,maxY:451},
    {id:'boss-step1',x:1592,y:448,w:104,h:16,type:'oneWay'},
    {id:'boss-step2',x:1672,y:400,w:104,h:16,type:'oneWay'},
    {id:'boss-arena',x:1744,y:336,w:256,h:80}
  ],
  hazards:[
    {id:'mud',type:'slow',x:150,y:544,w:130,h:16,slow:0.45},
    {id:'wax-a',type:'sticky',x:300,y:544,w:120,h:16,slow:0.35,staminaCost:1},
    {id:'pages-a',type:'projectile',x:718,y:80,w:32,h:32,interval:1.2,speedY:225,damage:2},
    {id:'stun-bell',type:'stun',x:1088,y:480,w:48,h:16,stun:0.6},
    {id:'spikes-wall',type:'damage',x:1192,y:480,w:48,h:16,damage:3},
    {id:'kb-boss',type:'knockback',x:1420,y:480,w:48,h:16,damage:1,knockX:200,knockY:-200}
  ],
  enemies:[
    {id:'road-goblin',type:'goblin',sprite:'pf-goblin',x:280,y:560,w:24,h:38,hp:44,damage:2,speed:38,patrolMin:200,patrolMax:450,frameCount:12,scale:.88},
    {id:'gap-eye',type:'flying-eye',sprite:'pf-flying-eye',x:630,y:430,w:26,h:30,hp:34,damage:2,speed:30,patrolMin:530,patrolMax:720,frameCount:6,scale:.8,flying:true,baseY:430},
    {id:'spore-tyrant',type:'mushroom',sprite:'pf-mushroom',name:'The Spore Tyrant',boss:true,x:912,y:560,w:52,h:58,hp:140,damage:3,speed:24,aggro:210,patrolMin:828,patrolMax:1004,frameCount:7,animRate:6,scale:2.0,burstFrame:9,
      ranged:{interval:1.9,speed:165,damage:3,range:380,rangeY:240,delay:0.9,sprite:'pf-mushroom-projectile',frameCount:8,animRate:14,scale:.5,w:20,h:20,color:'#9f3e45'}},
    {id:'raised-goblin',type:'goblin',sprite:'pf-goblin',x:1150,y:496,w:24,h:38,hp:44,damage:2,speed:34,patrolMin:1072,patrolMax:1250,frameCount:12,scale:.88},
    {id:'wall-skeleton',type:'skeleton',sprite:'pf-skeleton',x:1430,y:432,w:24,h:40,hp:52,damage:3,speed:28,patrolMin:1376,patrolMax:1480,frameCount:6,scale:.9},
    {id:'approach-eye',type:'flying-eye',sprite:'pf-flying-eye',x:1700,y:380,w:26,h:30,hp:34,damage:2,speed:28,patrolMin:1660,patrolMax:1790,frameCount:6,scale:.8,flying:true,baseY:380},
    {id:'gate-skeleton',type:'skeleton',sprite:'pf-skeleton',x:1800,y:336,w:24,h:40,hp:52,damage:3,speed:30,patrolMin:1752,patrolMax:1940,frameCount:6,scale:.9}
  ],
  bossTrigger:{id:'gate-sexton-marrow',x:1820,y:272,w:100,h:64,lock:{x:1680,y:200,w:400,h:216}},
  exit:{id:'to-mempool-yard',x:1900,y:316,w:40,h:80}};
const BATTLE_LEVEL={id:'a1-mempool-yard',name:'Mempool Yard',width:1500,height:920,spawn:{x:230,y:420},physics:{speed:180},
  creatures:{hollow:{hp:22,speed:46,damage:3,reach:18,radius:10,color:'#7c3936'},hound:{hp:16,speed:74,damage:2,reach:16,radius:9,color:'#c66c34'},knight:{hp:36,speed:35,damage:5,reach:20,radius:12,color:'#8e969b'},goblin:{hp:24,speed:48,damage:4,reach:20,radius:12,color:'#9e6a3e',asset:'pf-goblin',scale:.72},skeleton:{hp:36,speed:38,damage:5,reach:22,radius:12,color:'#d4d0c8',asset:'pf-skeleton',scale:.74},mushroom:{hp:30,speed:24,damage:3,reach:20,radius:13,color:'#9f3e45',asset:'pf-mushroom',scale:.7},'flying-eye':{hp:24,speed:56,damage:3,reach:18,radius:10,color:'#b65a48',asset:'pf-flying-eye',scale:.66},default:{hp:18,speed:42,damage:2,reach:16,radius:10,color:'#8c7650'}},
  zones:[{id:'west-tablets',x:120,y:250,w:380,h:280,regen:9,clearFor:14},{id:'east-ledger',x:760,y:220,w:430,h:320,regen:7,clearFor:16},{id:'south-well',x:500,y:590,w:420,h:230,regen:11,clearFor:12}],
  waves:[{id:'first-debtors',at:0.4,zoneId:'west-tablets',spawns:[{type:'goblin',x:320,y:330,count:2},{type:'mushroom',x:410,y:455,count:1}]},{id:'ledger-knights',at:5.5,zoneId:'east-ledger',spawns:[{type:'skeleton',x:870,y:320,count:2},{type:'flying-eye',x:1030,y:440,count:2}]},{id:'well-surge',at:10.5,zoneId:'south-well',spawns:[{type:'hound',x:630,y:690,count:2},{type:'hollow',x:760,y:710,count:2},{type:'goblin',x:820,y:660,count:1}]}]};
const TURN_ENCOUNTER={id:'duel-demo',name:'Sparring',opponent:{name:'Hollow Duelist',hp:64,attack:9,defense:1,color:'#7c3936',sprite:'hollow'}};
const BOSS_SCRIPT={id:'gate-sexton-marrow',name:'Gate Sexton Marrow',beat:0.8,segments:[
  {mode:'platformer',name:'Parish Road approach',payload:PLAT_LEVEL,beatText:'The tithe-house gate looms...',complete:{event:'boss'}},
  {mode:'battlefield',name:'Tithe-house yard',payload:BATTLE_LEVEL,beatText:'The Sexton stamps the dead awake.',complete:{event:'cleared'}},
  {mode:'turnbased',name:'Marrow, face to face',payload:TURN_ENCOUNTER,beatText:'He raises the ledger-stamp.',complete:{event:'duel'}}
]};
/* Area 1 bosses as story-gated, multi-play-style encounters (bible: Gracefall Parish). */
const TURN_SEXTON={id:'duel-sexton',name:'Gate Sexton Marrow',opponent:{name:'Gate Sexton Marrow',hp:96,attack:14,defense:2,color:'#d8b36b',sprite:'sexton'}};
const TURN_WARDEN={id:'duel-warden',name:'Mempool Warden',opponent:{name:'Mempool Warden',hp:92,attack:13,defense:1,color:'#b88cff',sprite:'mempool'}};
/* Mother Tallow hp = 260 is canon (DESIGN-BIBLE.md Area 1: "hp 260, dmg 22..."); matches the index.html registry. */
const TURN_TALLOW={id:'duel-tallow',name:'Mother Tallow',opponent:{name:'Mother Tallow',hp:260,attack:18,defense:3,color:'#f1c75b',sprite:'tallow'}};
/* Tallow House: vertical wax-choked interior, rising lift, dripping-wax hazards — distinct from the Parish Road climb. */
const PLAT_TALLOW_HOUSE={id:'a1-tallow-house',name:'Tallow House',width:1080,height:720,spawn:{x:60,y:616},physics:{maxRun:195,jump:445},
  platforms:[{id:'ground',x:0,y:660,w:1080,h:60,type:'solid'},{id:'shelf-a',x:90,y:580,w:130,h:12,type:'oneWay'},{id:'mid-floor',x:320,y:560,w:260,h:14,type:'solid'},{id:'wax-lift',x:510,y:510,w:110,h:14,type:'solid',vy:32,minY:400,maxY:520},{id:'shelf-b',x:120,y:460,w:160,h:12,type:'oneWay'},{id:'walkway',x:650,y:430,w:200,h:14,type:'solid'},{id:'step-a',x:200,y:360,w:120,h:14,type:'solid'},{id:'step-b',x:750,y:340,w:140,h:12,type:'oneWay'},{id:'upper',x:380,y:270,w:260,h:14,type:'solid'},{id:'altar',x:700,y:190,w:230,h:14,type:'solid'}],
  hazards:[{id:'wax-pool-a',type:'slow',x:130,y:646,w:180,h:14,slow:0.45},{id:'wax-pool-b',type:'slow',x:380,y:545,w:190,h:14,slow:0.42},{id:'drip-a',type:'damage',x:275,y:545,w:28,h:14,damage:2},{id:'drip-b',type:'damage',x:655,y:415,w:28,h:14,damage:2},{id:'wax-fall-a',type:'projectile',x:360,y:60,w:24,h:20,interval:1.2,speedY:250,damage:3},{id:'wax-fall-b',type:'projectile',x:640,y:80,w:24,h:20,interval:1.8,speedY:240,damage:3},{id:'wax-seal',type:'sticky',x:395,y:255,w:240,h:14,slow:0.3,staminaCost:2},{id:'flame-pillar',type:'stun',x:560,y:250,w:46,h:20,stun:0.65},{id:'wax-burst',type:'knockback',x:780,y:170,w:44,h:20,damage:2,knockX:-240,knockY:-200}],
  bossTrigger:{id:'mother-tallow',x:740,y:120,w:160,h:70,lock:{x:580,y:80,w:470,h:220}},exit:{id:'tallow-echoes',x:1040,y:580,w:34,h:80}};
/* Tallow Echoes: fast hollow rush + wax-knight golems — distinct creature tuning vs the Mempool Yard pending dead. */
const BATTLE_TALLOW_ECHOES={id:'a1-tallow-echoes',name:'Tallow Echoes',width:1200,height:800,spawn:{x:190,y:360},physics:{speed:170},
  creatures:{'tallow-echo':{hp:10,speed:100,damage:2,reach:14,radius:8,color:'#f5e8d0'},knight:{hp:48,speed:28,damage:7,reach:22,radius:13,color:'#d4b85a'},hound:{hp:18,speed:65,damage:3,reach:16,radius:9,color:'#e87d3e'},default:{hp:14,speed:55,damage:2,reach:14,radius:9,color:'#b8a870'}},
  zones:[{id:'wax-antechamber',x:80,y:160,w:360,h:300,regen:8,clearFor:10},{id:'tallow-chapel',x:520,y:150,w:400,h:360,regen:6,clearFor:14},{id:'candle-ring',x:300,y:520,w:580,h:220,regen:10,clearFor:11}],
  waves:[{id:'echo-rush',at:0.3,zoneId:'wax-antechamber',spawns:[{type:'tallow-echo',x:280,y:280,count:5},{type:'tallow-echo',x:360,y:360,count:3}]},{id:'wax-sentries',at:5.0,zoneId:'tallow-chapel',spawns:[{type:'knight',x:650,y:260,count:2},{type:'tallow-echo',x:820,y:380,count:4}]},{id:'candle-surge',at:11.0,zoneId:'candle-ring',spawns:[{type:'hound',x:440,y:580,count:3},{type:'tallow-echo',x:600,y:620,count:5},{type:'knight',x:760,y:560,count:1}]}]};
const AREA1_ENCOUNTERS={
  sexton:{id:'gate-sexton-marrow',name:'Gate Sexton Marrow',beat:0.8,segments:[
    {mode:'platformer',name:'Parish Road approach',payload:PLAT_LEVEL,beatText:'The tithe-house gate looms...',complete:{event:'boss'}},
    {mode:'turnbased',name:'Marrow, face to face',payload:TURN_SEXTON,beatText:'He raises the ledger-stamp.',complete:{event:'duel'}}
  ]},
  mempool:{id:'mempool-warden',name:'Mempool Warden',beat:0.8,segments:[
    {mode:'battlefield',name:'The Mempool Yard',payload:BATTLE_LEVEL,beatText:'The pending dead stir.',complete:{event:'cleared'}},
    {mode:'turnbased',name:'The Warden',payload:TURN_WARDEN,beatText:'It drags its chains forward.',complete:{event:'duel'}}
  ]},
  tallow:{id:'mother-tallow',name:'Mother Tallow',beat:0.9,segments:[
    {mode:'platformer',name:'Tallow House',payload:PLAT_TALLOW_HOUSE,beatText:'Wax names burn in the dark.',complete:{event:'boss'}},
    {mode:'battlefield',name:'Tallow Echoes',payload:BATTLE_TALLOW_ECHOES,beatText:'The echoes swarm.',complete:{event:'cleared'}},
    {mode:'turnbased',name:'Mother Tallow',payload:TURN_TALLOW,beatText:'She melts toward you.',complete:{event:'duel'}}
  ]}
};
/* ---- Area 2 — The Shroud Vaults ---------------------------------------- */
const AREA2_TOWN={id:'a2-vault-anteroom',name:'Vault Anteroom / Forklight Hearthlight',
  hearthlight:{id:'forklight',free:true,safe:true},
  npcs:[
    {id:'keeper-ancestry',name:'Keeper of Ancestry',role:'Explains inherited debt-chain and confirms authorship at the Ledger-Bound fracture.'},
    {id:'custodian-archivist',name:'Custodian Archivist',role:"Warns the deep records rest but never stay rested."},
    {id:'librarian-shade',name:'Librarian Shade',role:'Advanced RUNE relic vendor and fork-lore witness.'},
    {id:'keeper-margins',name:'Keeper of Margins',role:'Optional re-inscription side quest; testimony weakens the Debt Foreman.'},
    {id:'vault-custodians',name:'Vault Custodians',role:'Gold cosmetics only.'}
  ],
  sideQuest:{id:'keeper-margins',interactionKey:'q06:margin-scroll',effect:'weaken-debt-foreman'}};
/* Debt Mines: descent through a forked crystallized shaft, Canon left / Schism right, forced crossing bridge at mid-depth. */
const PLAT_DEBT_MINES={id:'a2-debt-mines',name:'Debt Mines & Ledger Cistern',width:1300,height:760,spawn:{x:100,y:90},physics:{maxRun:200,jump:458},
  fork:{splitX:650,
    canon:{label:'CANON',region:{x:0,y:0,w:520,h:540},effect:{speedMul:0.92},identityRunes:['R','E','C','O','R','D','E','D'],desc:'stable amber platforms, slower but predictable'},
    schism:{label:'SCHISM',region:{x:840,y:0,w:460,h:540},effect:{speedMul:1.08,damagePerSecond:2,damageEvery:0.75},identityRunes:['D','E','D','R','O','C','E','R'],desc:'faster mirror path with toxic debt-pressure'},
    crossing:{region:{x:340,y:470,w:620,h:44},requiresBothSpellings:true,solution:'RECORDED|DEDROCER'}},
  platforms:[{id:'entrance',x:0,y:120,w:280,h:14,type:'solid'},{id:'c1',x:0,y:200,w:210,h:12,type:'solid'},{id:'c2',x:60,y:290,w:180,h:12,type:'solid'},{id:'c3',x:0,y:370,w:200,h:12,type:'solid'},{id:'c4',x:80,y:450,w:160,h:12,type:'solid'},{id:'pendulum',x:140,y:330,w:110,h:12,type:'solid',vx:48,minX:80,maxX:330},{id:'cross',x:340,y:490,w:620,h:14,type:'solid'},{id:'s1',x:1080,y:200,w:220,h:10,type:'oneWay'},{id:'s2',x:1000,y:290,w:190,h:10,type:'oneWay'},{id:'s3',x:1100,y:370,w:200,h:10,type:'oneWay'},{id:'s4',x:1020,y:450,w:170,h:10,type:'oneWay'},{id:'boss-floor',x:380,y:700,w:740,h:60,type:'solid'},{id:'boss-wall-l',x:380,y:560,w:50,h:140,type:'solid'},{id:'boss-wall-r',x:1070,y:560,w:50,h:140,type:'solid'},{id:'boss-step-l',x:440,y:640,w:120,h:14,type:'solid'},{id:'boss-step-r',x:940,y:640,w:120,h:14,type:'solid'}],
  hazards:[{id:'shard-a',type:'damage',x:90,y:285,w:30,h:12,damage:2},{id:'shard-b',type:'damage',x:180,y:365,w:30,h:12,damage:2},{id:'crystal-a',type:'projectile',x:110,y:80,w:20,h:16,interval:1.6,speedY:265,damage:3},{id:'crystal-b',type:'projectile',x:230,y:80,w:20,h:16,interval:2.2,speedY:258,damage:3},{id:'pendulum-blow',type:'knockback',x:180,y:285,w:80,h:36,damage:2,knockX:240,knockY:-200},{id:'echo-stun',type:'stun',x:80,y:356,w:36,h:14,stun:0.55},{id:'gas-a',type:'slow',x:1000,y:282,w:190,h:22,slow:0.34},{id:'gas-b',type:'slow',x:1020,y:442,w:170,h:22,slow:0.31},{id:'vent-a',type:'damage',x:1080,y:194,w:28,h:14,damage:3},{id:'vent-b',type:'damage',x:1100,y:362,w:28,h:14,damage:3},{id:'current',type:'slow',x:400,y:476,w:500,h:14,slow:0.40},{id:'crystal-s',type:'projectile',x:1140,y:80,w:20,h:16,interval:1.3,speedY:275,damage:3},{id:'gas-cross',type:'slow',x:540,y:474,w:260,h:14,slow:0.38}],
  bossTrigger:{id:'debt-foreman',x:660,y:620,w:180,h:80,lock:{x:400,y:530,w:700,h:240}},exit:{id:'to-ledger-vaults',x:0,y:640,w:40,h:80}};
/* Ledger Vaults: underground split-zone arena, Canon left (amber) / Schism right (green). */
const BATTLE_LEDGER_VAULTS={id:'a2-ledger-vaults',name:"Ledger Vaults / Well's Mouth",width:1600,height:900,spawn:{x:200,y:400},physics:{speed:175},
  fork:{canonZone:'canon-sanctuary',schismZone:'schism-chasm',centerZone:'well-mouth',
    canon:{enemy:'canon-auditor',style:'armored methodical pressure',regen:12},
    schism:{enemy:'schism-shadow',style:'fast phasing pressure',regen:5}},
  creatures:{'hollow-ancestor':{hp:18,speed:80,damage:3,reach:14,radius:8,color:'#8cb8e0'},'canon-auditor':{hp:52,speed:28,damage:7,reach:24,radius:13,color:'#d4a83e'},'schism-shadow':{hp:14,speed:115,damage:4,reach:14,radius:7,color:'#4ecb7a'},default:{hp:20,speed:50,damage:3,reach:14,radius:9,color:'#7c9cbc'}},
  zones:[{id:'canon-sanctuary',x:80,y:150,w:500,h:320,regen:12,clearFor:16},{id:'schism-chasm',x:1020,y:150,w:500,h:320,regen:5,clearFor:14},{id:'well-mouth',x:600,y:500,w:400,h:280,regen:8,clearFor:12}],
  waves:[{id:'canon-first',at:0.5,zoneId:'canon-sanctuary',spawns:[{type:'canon-auditor',x:250,y:250,count:2},{type:'hollow-ancestor',x:420,y:360,count:3}]},{id:'schism-rush',at:5.5,zoneId:'schism-chasm',spawns:[{type:'schism-shadow',x:1150,y:260,count:4},{type:'hollow-ancestor',x:1280,y:380,count:3}]},{id:'well-surge',at:12.0,zoneId:'well-mouth',spawns:[{type:'canon-auditor',x:720,y:560,count:2},{type:'schism-shadow',x:880,y:620,count:3},{type:'hollow-ancestor',x:650,y:680,count:4}]}]};
/* Area 2 fork bosses use the turn-based engine's additive dual-chain model:
   opponent{} stays for sprite/attack/defense back-compat; dualChain.a/b are the real bars
   (BOTH must reach 0). crossHeal:true => striking one half mends the other unless Strike Both. */
const TURN_FOREMAN={id:'duel-foreman',name:'The Debt Foreman',opponent:{name:'The Debt Foreman',hp:140,attack:16,defense:3,color:'#4ecbaa',sprite:'foreman'},
  dualChain:{a:{hp:70,label:'CANON',color:'#d4a83e'},b:{hp:70,label:'SCHISM',color:'#4ecb7a'},crossHeal:false}};
const TURN_BIFURCATED={id:'duel-bifurcated',name:'Bifurcated Guard',opponent:{name:'Bifurcated Guard',hp:120,attack:14,defense:4,color:'#d4a83e',sprite:'bifurcated'},
  dualChain:{a:{hp:60,label:'LEFT',color:'#d4a83e'},b:{hp:60,label:'RIGHT',color:'#4ecb7a'},crossHeal:true}};
/* Ledger-Bound (FINAL): single-HP Phase 1, then opponent.phase2 splits it into a dual-pool
   re-merging arena at 40% HP (mergePerTurn regen unless Strike Both). Mints 'The Contested Will'. */
const TURN_LEDGERBOUND={id:'duel-ledgerbound',name:'The Ledger-Bound',finalStroke:{requiresCenter:true,centerLabel:'FISSURE-CENTER',sigilKey:'contested-will'},opponent:{name:'The Ledger-Bound',hp:220,attack:20,defense:5,color:'#a8c8ff',sprite:'ledgerbound',
  phase2:{threshold:0.4,aHp:60,bHp:60,aLabel:'CANON',bLabel:'SCHISM',aColor:'#d4a83e',bColor:'#4ecb7a',mergePerTurn:5,finalStroke:'center'}}};
const AREA2_ENCOUNTERS={
  foreman:{id:'debt-foreman',name:'The Debt Foreman',beat:0.8,segments:[
    {mode:'platformer',name:'Descent into the Debt Mines',payload:PLAT_DEBT_MINES,beatText:'The shaft swallows names.',complete:{event:'boss'}},
    {mode:'turnbased',name:'The Foreman rises',payload:TURN_FOREMAN,beatText:'Its ledger-stamp cracks the stone.',complete:{event:'duel'}}
  ]},
  bifurcated:{id:'bifurcated-guard',name:'Bifurcated Guard',beat:0.8,segments:[
    {mode:'battlefield',name:'The Ledger Vaults',payload:BATTLE_LEDGER_VAULTS,beatText:'Two chains converge.',complete:{event:'cleared'}},
    {mode:'turnbased',name:'The Guard divides',payload:TURN_BIFURCATED,beatText:'Amber and green pull each way.',complete:{event:'duel'}}
  ]},
  ledgerbound:{id:'ledger-bound',name:'The Ledger-Bound',beat:0.9,segments:[
    {mode:'platformer',name:'The Forked Archive',payload:PLAT_DEBT_MINES,beatText:'The fissure opens beneath your feet.',complete:{event:'boss'}},
    {mode:'battlefield',name:'The Named Paladins',payload:BATTLE_LEDGER_VAULTS,beatText:'The dead inherit your record.',complete:{event:'cleared'}},
    {mode:'turnbased',name:'The Ledger-Bound',payload:TURN_LEDGERBOUND,beatText:'Stone names press down.',complete:{event:'duel'}}
  ]}
};
/* ---- Area 3 — The Archive of Attestation --------------------------------- */
/* Ascent of Testimony: vertical climb that contradicts itself; second half is floaty-gravity (high jump, slow fall) to simulate the "inverted" upper section. */
const PLAT_ASCENT_TESTIMONY={id:'a3-ascent-testimony',name:'Ascent of Testimony',width:960,height:880,spawn:{x:100,y:800},physics:{maxRun:210,jump:520},
  platforms:[{id:'ground',x:0,y:840,w:960,h:40,type:'solid'},{id:'t1-a',x:60,y:760,w:180,h:12,type:'solid'},{id:'t1-b',x:380,y:730,w:160,h:12,type:'oneWay'},{id:'t1-c',x:700,y:750,w:200,h:12,type:'solid'},{id:'t2-a',x:140,y:660,w:160,h:12,type:'oneWay'},{id:'t2-b',x:560,y:640,w:180,h:12,type:'solid'},{id:'t2-c',x:800,y:660,w:140,h:12,type:'oneWay'},{id:'t3-a',x:60,y:560,w:200,h:12,type:'solid'},{id:'t3-b',x:440,y:540,w:160,h:12,type:'oneWay'},{id:'t3-c',x:720,y:555,w:180,h:12,type:'solid'},{id:'invert-marker',x:280,y:480,w:400,h:8,type:'solid'},{id:'u1-a',x:100,y:400,w:160,h:10,type:'oneWay'},{id:'u1-b',x:480,y:380,w:200,h:10,type:'oneWay'},{id:'u1-c',x:760,y:400,w:160,h:10,type:'solid'},{id:'u2-a',x:60,y:300,w:200,h:10,type:'oneWay'},{id:'u2-b',x:360,y:280,w:160,h:10,type:'solid'},{id:'u2-c',x:680,y:300,w:220,h:10,type:'oneWay'},{id:'u3-a',x:140,y:200,w:200,h:10,type:'solid'},{id:'u3-b',x:500,y:180,w:200,h:10,type:'solid'},{id:'u3-c',x:820,y:200,w:100,h:10,type:'oneWay'},{id:'boss-shelf',x:360,y:100,w:340,h:14,type:'solid'}],
  hazards:[{id:'page-fall-a',type:'projectile',x:200,y:840,w:20,h:16,interval:1.4,speedY:-280,damage:2},{id:'page-fall-b',type:'projectile',x:600,y:840,w:20,h:16,interval:1.8,speedY:-275,damage:2},{id:'ink-static-a',type:'stun',x:400,y:465,w:160,h:16,stun:0.6},{id:'ink-static-b',type:'stun',x:700,y:545,w:120,h:12,stun:0.5},{id:'paradox-echo',type:'damage',x:480,y:370,w:40,h:14,damage:3},{id:'redact-zone',type:'slow',x:280,y:250,w:400,h:30,slow:0.28},{id:'compliance-drag',type:'slow',x:0,y:800,w:960,h:40,slow:0.50},{id:'decree-blow-a',type:'knockback',x:620,y:180,w:50,h:20,damage:2,knockX:-280,knockY:180},{id:'decree-blow-b',type:'knockback',x:100,y:280,w:50,h:20,damage:2,knockX:280,knockY:180}],
  bossTrigger:{id:'scrivener',x:440,y:54,w:180,h:46,lock:{x:300,y:0,w:440,h:200}},exit:{id:'to-seized-yard',x:900,y:760,w:40,h:80}};
/* Seized Asset Yard: three overlapping ledger-zones, Contradiction Hollows + Relic Shades. */
const BATTLE_SEIZED_YARD={id:'a3-seized-yard',name:'Seized Asset Yard / Contradiction Field',width:1400,height:900,spawn:{x:200,y:380},physics:{speed:168},
  creatures:{'hollow-ancestor':{hp:24,speed:72,damage:3,reach:14,radius:9,color:'#d0c0ff'},'audit-wolf':{hp:16,speed:130,damage:4,reach:12,radius:7,color:'#ff80c0'},'relic-shade':{hp:44,speed:32,damage:8,reach:22,radius:12,color:'#e8c880'},default:{hp:20,speed:55,damage:3,reach:14,radius:9,color:'#c0d0e8'}},
  zones:[{id:'recorded-zone',x:80,y:140,w:380,h:300,regen:10,clearFor:14},{id:'unrecorded-zone',x:960,y:140,w:360,h:300,regen:6,clearFor:12},{id:'void-zone',x:540,y:480,w:320,h:300,regen:4,clearFor:16}],
  waves:[{id:'contradiction-first',at:0.4,zoneId:'recorded-zone',spawns:[{type:'hollow-ancestor',x:200,y:240,count:4},{type:'audit-wolf',x:380,y:320,count:2}]},{id:'relic-shades',at:6.0,zoneId:'unrecorded-zone',spawns:[{type:'relic-shade',x:1060,y:240,count:2},{type:'hollow-ancestor',x:1200,y:340,count:3}]},{id:'void-surge',at:13.0,zoneId:'void-zone',spawns:[{type:'audit-wolf',x:620,y:580,count:4},{type:'hollow-ancestor',x:720,y:660,count:4},{type:'relic-shade',x:840,y:580,count:1}]}]};
const TURN_SCRIVENER={id:'duel-scrivener',name:'The Scrivener',opponent:{name:'The Scrivener',hp:100,attack:14,defense:2,color:'#1a1a2e',sprite:'scrivener'}};
const TURN_CASCADE={id:'duel-cascade',name:'Cascade Anchor',opponent:{name:'Cascade Anchor',hp:130,attack:11,defense:6,color:'#e8f0ff',sprite:'cascade'}};
const TURN_AUDITOR={id:'duel-auditor',name:'The Auditor',opponent:{name:'The Auditor',hp:280,attack:8,defense:8,color:'#f0f0e8',sprite:'auditor'}};
const AREA3_ENCOUNTERS={
  scrivener:{id:'scrivener',name:'The Scrivener',beat:0.8,segments:[
    {mode:'platformer',name:'Ascent of Testimony',payload:PLAT_ASCENT_TESTIMONY,beatText:'The ledger eats itself.',complete:{event:'boss'}},
    {mode:'turnbased',name:'The Scrivener rewrites the room',payload:TURN_SCRIVENER,beatText:'Every platform vanishes.',complete:{event:'duel'}}
  ]},
  cascade:{id:'cascade-anchor',name:'Cascade Anchor',beat:0.8,segments:[
    {mode:'battlefield',name:'The Seized Asset Yard',payload:BATTLE_SEIZED_YARD,beatText:'Your relics walk as husks.',complete:{event:'cleared'}},
    {mode:'turnbased',name:'Contest three decrees',payload:TURN_CASCADE,beatText:'You cannot damage it — contest its logic.',complete:{event:'duel'}}
  ]},
  auditor:{id:'the-auditor',name:'The Auditor',beat:0.9,segments:[
    {mode:'platformer',name:'The Testimony Ascent',payload:PLAT_ASCENT_TESTIMONY,beatText:'Paradox waves invert your controls.',complete:{event:'boss'}},
    {mode:'battlefield',name:'The Temporal Rift',payload:BATTLE_SEIZED_YARD,beatText:'Past versions of every enemy spawn.',complete:{event:'cleared'}},
    {mode:'turnbased',name:'Make your choice',payload:TURN_AUDITOR,beatText:'The Auditor rotates one final time. Answer it.',complete:{event:'duel'}}
  ]}
};
/* ---- NPCs — branching dialogue (issue #22, lore/dialogue lane) ----------- */
/* DIALOGUE DATA FORMAT (reusable for Area 2/3 NPCs — the index.html Dialogue UI consumes this):
   npc.dialogue = { start:'nodeId', repeat:'nodeId'(optional), nodes:{ id:node, ... } }
     start  — entry node the first time you talk to this NPC.
     repeat — entry node on every subsequent talk (defaults to start when omitted).
   node = {
     speaker: 'Name'        // optional per-node speaker override (defaults to npc.name)
     text: ['line', ...]    // lines shown one at a time; advance with E / Space
     choices: [             // optional; shown after the last line. Arrow keys pick, E confirms.
       { label:'...', goto:'nodeId' }
     ]
     goto: 'nodeId'         // optional; auto-jump to another node after the last line (no choices)
     end: true              // optional; closes the conversation after the last line
   }
   A node with neither choices, goto, nor end simply closes when its last line is dismissed. */
const NPCS=[
  {id:'recorder-chaplain', x:-72, y:-26, color:'#f1c75b', sprite:'knight', name:'Chaplain Verity', role:'Hearthlight Recorder',
    dialogue:{ start:'intro', repeat:'again', nodes:{
      intro:{ text:[
        'Welcome, Recorded. The Hearthlight has your name already — it wrote you the moment you woke.',
        'I keep the registry well. Here your RUNE is confirmed, your relics forged, your stats raised. Rest is free; the dead do not cross this plaza.'],
        choices:[
          {label:'What is this place?', goto:'place'},
          {label:'How do I grow stronger?', goto:'power'},
          {label:'I should go.', goto:'farewell'} ] },
      place:{ text:[
        'A tax-house, once. The Chainwell turns beneath these stones — the ledger of every soul that ever owed.',
        'We turned it into sanctuary. Better the well keep us warm than swallow us cold.'],
        goto:'intro' },
      power:{ text:[
        'Bring RUNE to the Hearthlight and I will record the spend as levels. That ledger is the only one that grants power.',
        'Gold buys nothing but vestment and dye. No coin hurries a soul up the registry — only the grind, only the proof.'],
        goto:'intro' },
      farewell:{ text:['Go correctly filed, Recorded. The bells will mark your confirmations.'], end:true },
      again:{ text:['Back at the warm ledger? Rest, forge, or raise your record — I will witness all three.'],
        choices:[
          {label:'Tell me of Mother Tallow.', goto:'tallow'},
          {label:'Just resting.', goto:'farewell'} ] },
      tallow:{ text:[
        'She was the First Recorded — our original keeper. She melted into wax to bind names when the debts outgrew paper.',
        'When you face her, do not hate her. She bound herself so debtors might still find a path to confirmation. I will be there when she falls.'],
        goto:'again' } }} },
  {id:'scribe-archivist', x:96, y:18, color:'#9b74ff', sprite:'sorcerer', name:'Archivist Quill', role:'Relic Scribe',
    dialogue:{ start:'intro', repeat:'again', nodes:{
      intro:{ text:[
        'Mind the dust — every speck is a name nobody paid to keep clean.',
        'I trade in relics. RUNE forged into edge and ward. Real power, honestly earned — none of that cosmetic glitter the Acolyte peddles.'],
        choices:[
          {label:'Show me what relics do.', goto:'relics'},
          {label:'Who was here before us?', goto:'legacy'},
          {label:'Maybe later.', goto:'farewell'} ] },
      relics:{ text:[
        'Forge at the Hearthlight; I only catalogue. An Ember Edge bites harder, a Warden Sigil keeps you breathing.',
        'A blessed relic strikes Mother Tallow truer — the wax remembers the hands that recorded it.'],
        goto:'intro' },
      legacy:{ text:[
        'Tallow kept these ledgers before the melting. Her hand is in every old margin — inheritances, compounded down the bloodlines.',
        'What you owe, you did not always borrow. Some debts are willed to you. Remember that when you descend north.'],
        goto:'intro' },
      farewell:{ text:['The archive keeps. So do I.'], end:true },
      again:{ text:['Back among the shelves? The relic ledger has not changed since you last read it — but the dust has.'],
        choices:[
          {label:'Refresh me on relics.', goto:'relics'},
          {label:'Nothing today.', goto:'farewell'} ] } }} },
  {id:'debt-confessional', x:188, y:54, color:'#7c3936', sprite:'hollow', name:'The Confessional', role:'Debt Booth',
    dialogue:{ start:'intro', repeat:'intro', nodes:{
      intro:{ text:[
        'Kneel, debtor. State the sum you cannot pay.',
        'This is where it begins — a debt confessed, a debt recorded, a debt that will not be forgiven. Watch the booth and learn how a Hollow is made.'],
        choices:[
          {label:'How does a soul go Hollow?', goto:'process'},
          {label:'Where do the unpaid go?', goto:'north'},
          {label:'Leave the booth.', goto:'farewell'} ] },
      process:{ text:[
        'First the debt compounds. Then the name greys. Then the body forgets it was ever owed-to, and only remembers it owes.',
        'A Hollow is not punished. It is simply processed — filed, like all of us, into the shape the ledger needs.'],
        goto:'intro' },
      north:{ text:[
        'North. Always north, and always down — to the Shroud Vaults, where the unpaid are kept against their heirs.',
        'You will go there too, in time. The booth has already written it.'],
        goto:'intro' },
      farewell:{ text:['The booth keeps your confession. It keeps everything.'], end:true } }} },
  {id:'chapel-acolyte', x:-36, y:42, color:'#7aa7ff', sprite:'knight', name:'Acolyte Plume', role:'Vestment Keeper',
    dialogue:{ start:'intro', repeat:'again', nodes:{
      intro:{ text:[
        'Oh — a visitor with COLOUR potential! Stand still, let me imagine you in azure.',
        'I keep the vestments and dyes. Gold only, and Gold buys looks alone — never an ounce of strength. The Archivist will tell you the same, grumpily.'],
        choices:[
          {label:'Gold gets me no power?', goto:'nopower'},
          {label:'Show me vestments.', goto:'cosmetics'},
          {label:'Not my style.', goto:'farewell'} ] },
      nopower:{ text:[
        'None whatsoever. That is the whole point, darling — a Gilded Champion and a tarnished Recorded swing the very same blade.',
        'You buy Gold with real settlement, you wear it, you turn heads at the Hearthlight. Power you must earn in RUNE, like everyone.'],
        goto:'intro' },
      cosmetics:{ text:[
        'Press B at any time to open the wardrobe. Crimson, Verdant, Voidwalker — all yours, for Gold.',
        'A soul filed correctly may as well be filed beautifully.'],
        goto:'intro' },
      farewell:{ text:['Come back when you crave a little colour.'], end:true },
      again:{ text:['Reconsidered the azure? The wardrobe is one tap of B away.'],
        choices:[
          {label:'Remind me — Gold and power?', goto:'nopower'},
          {label:'Still no.', goto:'farewell'} ] } }} },
  {id:'sexton-marrow-elder', x:228, y:-104, color:'#8d9386', sprite:'knight', name:'Sexton Greave', role:'Grave-Tender',
    dialogue:{ start:'intro', repeat:'again', nodes:{
      intro:{ text:[
        'Quiet round the stones, if you would. The Paid rest easy here — and the Unpaid only pretend to.',
        'Two kinds of grave in Gracefall. One marked with a settled flame, one left dark. I tend both, though only one tends back.'],
        choices:[
          {label:'Paid and Unpaid?', goto:'graves'},
          {label:'Why the candles?', goto:'candles'},
          {label:'Rest in peace.', goto:'farewell'} ] },
      graves:{ text:[
        'A Paid grave means the debt closed before the breath did. Those sleep. Those stay sleeping.',
        'An Unpaid grave is just a Hollow that has not stood up yet. Step lightly. Some of them are listening for their names.'],
        goto:'intro' },
      candles:{ text:[
        'A lit candle is a settled account — a flame the ledger accepts in place of the soul.',
        'When you see them gutter out east, in the Tallow House — do not relight them. Those names are screaming to stay lit.'],
        goto:'intro' },
      farewell:{ text:['Mind the dark stones on your way out.'], end:true },
      again:{ text:['Still walking among my stones? The Paid have not stirred. The Unpaid... we do not discuss.'],
        choices:[
          {label:'Tell me of the graves again.', goto:'graves'},
          {label:'I will go.', goto:'farewell'} ] } }} },
  {id:'sexton-junior', x:328, y:-122, color:'#cfa982', sprite:'hollow', name:'Tender Bram', role:'Grave-Digger',
    dialogue:{ start:'intro', repeat:'intro', nodes:{
      intro:{ text:[
        'Dug three new plots this morning. All Unpaid. They always are, lately.',
        'Old Greave says not to name them while I dig. I forget sometimes. Then they move.'],
        choices:[
          {label:'They move?', goto:'move'},
          {label:'Stay safe, digger.', goto:'farewell'} ] },
      move:{ text:[
        'Just the dirt settling. That is what Greave says. The dirt settling, upward, in the shape of a hand.',
        'I dig the holes. The ledger fills them. I try not to think about which order it does that in.'],
        goto:'intro' },
      farewell:{ text:['Back to the spade. Always more plots.'], end:true } }} }
];

  return {
    ECON, ENEMY_REWARDS, STORY, RELICS, LEVELING, SIGILS, SKINS, ASSETS, NPCS,
    PLAT_LEVEL, BATTLE_LEVEL, TURN_ENCOUNTER, BOSS_SCRIPT,
    TURN_SEXTON, TURN_WARDEN, TURN_TALLOW, PLAT_TALLOW_HOUSE, BATTLE_TALLOW_ECHOES, AREA1_ENCOUNTERS,
    AREA2_TOWN, PLAT_DEBT_MINES, BATTLE_LEDGER_VAULTS, TURN_FOREMAN, TURN_BIFURCATED, TURN_LEDGERBOUND, AREA2_ENCOUNTERS,
    PLAT_ASCENT_TESTIMONY, BATTLE_SEIZED_YARD, TURN_SCRIVENER, TURN_CASCADE, TURN_AUDITOR, AREA3_ENCOUNTERS
  };
});
