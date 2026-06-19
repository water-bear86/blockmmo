export const PVP_TYPES={
  challenge:'rc:pvp:challenge',
  accept:'rc:pvp:accept',
  decline:'rc:pvp:decline',
  state:'rc:pvp:state',
  hit:'rc:pvp:hit',
  forfeit:'rc:pvp:forfeit',
  result:'rc:pvp:result'
};

const DEF={speed:154, accel:980, friction:820, radius:9, attackRange:34, attackCd:.34, hurtCd:.38};

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function norm(x,y){ const d=Math.hypot(x,y)||1; return {x:x/d,y:y/d}; }
function hitRectCircle(r,c){ const x=clamp(c.x,r.x,r.x+r.w), y=clamp(c.y,r.y,r.y+r.h); return Math.hypot(c.x-x,c.y-y)<=c.r; }
function inputDown(input, a, b){ return !!(input[a]||input[b]); }
function call(api, name, ...args){ return api&&typeof api[name]==='function'?api[name](...args):undefined; }

const RIVAL_NAMES=['Cassian','Vell','Marrow','Quill','Ashen','Doole','Reeve','Sol','Wren','Tace','Bram','Orla'];
const RIVAL_TINTS=['#c2607a','#6fa3d6','#c8a24e','#7ec88a','#a98cff','#d98a4e','#e0708a','#5fb8c0'];

export function createBattlefieldMode(level={}){
  let ctx=null, api=null, player=null, camera=null, zones=[], waves=[], creatures=[], elapsed=0, nextId=1;
  let attackBox=null, stateSend=0, duel=null, pending={}, unsubs=[];
  let storm=null, rivals=[], projectiles=[], remaining=1, kills=0, banner=null, stormTick=0;
  const cfg={...DEF, ...(level.physics||{})};

  function reset(){
    const spawn=level.spawn||{x:80,y:80};
    player={x:spawn.x,y:spawn.y,vx:0,vy:0,r:cfg.radius,dirX:1,dirY:0,moving:false,hurtCd:0,attackCd:0};
    camera={x:0,y:0,w:640,h:360};
    zones=(level.zones||[]).map(z=>({...z,safeUntil:0,_everSpawned:false,_clearAnnounced:false}));
    waves=(level.waves||[]).map((w,i)=>({...w,id:w.id||'wave'+i,done:false}));
    creatures=[]; elapsed=0; nextId=1; attackBox=null; stateSend=0; duel=null; pending={};
    setupStorm(); spawnRivals(); projectiles=[]; kills=0; banner=null; stormTick=0; recomputeRemaining();
  }

  function setupStorm(){
    if(level.storm===false){ storm=null; return; }
    const W=level.width||1000, H=level.height||700, s=level.storm||{};
    const cx=s.cx!=null?s.cx:W/2, cy=s.cy!=null?s.cy:H/2;
    const r0=s.r0!=null?s.r0:Math.hypot(W,H)/2+24;
    const rMin=s.rMin!=null?s.rMin:Math.max(96, Math.min(W,H)*0.13);
    const dur=s.duration!=null?s.duration:44;
    storm={ cx, cy, r:r0, r0, rMin, start:s.start!=null?s.start:5, rate:s.rate!=null?s.rate:(r0-rMin)/dur, dps:s.dps!=null?s.dps:8, pulse:0 };
  }

  function spawnRivals(){
    rivals=[];
    if(level.rivals===false)return;
    const n=typeof level.rivals==='number'?level.rivals:(level.rivalCount||6);
    const W=level.width||1000, H=level.height||700;
    const cx=storm?storm.cx:W/2, cy=storm?storm.cy:H/2, rr=storm?storm.r*0.72:Math.min(W,H)*0.42;
    for(let i=0;i<n;i++){
      const a=(i/n)*Math.PI*2+0.35;
      rivals.push({
        id:'rv'+i, name:RIVAL_NAMES[i%RIVAL_NAMES.length], tint:RIVAL_TINTS[i%RIVAL_TINTS.length],
        x:clamp(cx+Math.cos(a)*rr, 24, W-24), y:clamp(cy+Math.sin(a)*rr, 24, H-24),
        vx:0, vy:0, dirX:0, dirY:1, r:9, hp:40, maxHp:40, dmg:6, speed:116+Math.random()*24,
        attackCd:Math.random()*.5, fireCd:1+Math.random()*1.2, hitFlash:0, dead:false,
        asset:(i%2)?'knight':'phantom', ranged:(i%3===0), reward:10+Math.floor(Math.random()*6)
      });
    }
  }

  function localId(){
    return (api&&api.net&&api.net.id)||(api&&api.player&&api.player.id)||(api&&api.player&&api.player.name)||'local';
  }

  function send(msg){
    if(api&&api.net&&typeof api.net.send==='function')api.net.send({...msg, from:msg.from||localId()});
  }

  function on(type, fn){
    if(!api||!api.net||typeof api.net.on!=='function')return;
    const off=api.net.on(type, fn);
    if(typeof off==='function')unsubs.push(off);
  }

  function listen(){
    on(PVP_TYPES.challenge, onChallenge);
    on(PVP_TYPES.accept, onAccept);
    on(PVP_TYPES.decline, onDecline);
    on(PVP_TYPES.state, onPeerState);
    on(PVP_TYPES.hit, onPeerHit);
    on(PVP_TYPES.forfeit, onForfeit);
    on(PVP_TYPES.result, onResult);
  }

  function enter(nextCtx, nextApi){
    ctx=nextCtx; api=nextApi||{}; reset();
    camera.w=(ctx&&ctx.canvas&&ctx.canvas.width)||api.viewW||640;
    camera.h=(ctx&&ctx.canvas&&ctx.canvas.height)||api.viewH||360;
    listen();
    syncHost();
    updateCamera();
    call(api, 'log', 'Battlefield loaded: '+(level.name||level.id||'open field'));
  }

  function exit(){
    for(const off of unsubs)off();
    unsubs=[];
    call(api, 'log', 'Leaving battlefield.');
  }

  function syncHost(){
    const p=api&&api.player;
    if(!p)return;
    p.x=player.x; p.y=player.y; p.vx=player.vx; p.vy=player.vy;
    p.dirX=player.dirX; p.dirY=player.dirY; p.moving=player.moving;
  }

  function spend(reason, data){
    const p=api&&api.player;
    if(!p||typeof p.spendStamina!=='function')return true;
    return p.spendStamina(reason, data)!==false;
  }

  function damage(amount, source){
    if(player.hurtCd>0)return;
    player.hurtCd=cfg.hurtCd;
    if(api&&api.player&&typeof api.player.damage==='function')api.player.damage(amount, source);
    else call(api, 'onDamage', amount, source);
  }

  function meleeDamage(){
    const p=api&&api.player;
    return p&&typeof p.getMeleeDamage==='function'?p.getMeleeDamage('battlefield'):1;
  }

  function pointInZone(p,z){ return p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h; }
  function zoneById(id){ return zones.find(z=>z.id===id)||null; }

  function spawnCreature(typeKey, x, y, zoneId){
    const t=(level.creatures&&level.creatures[typeKey])||level.creatures&&level.creatures.default||{};
    creatures.push({
      id:'c'+nextId++, key:typeKey, zoneId, x, y, r:t.radius||10,
      asset:t.asset||typeKey, scale:t.scale||1,
      hp:t.hp||12, maxHp:t.hp||12, speed:t.speed||42, damage:t.damage||1, reach:t.reach||17,
      color:t.color||'#9b6f50', attackCd:.2+Math.random()*.4, hitFlash:0, dead:false
    });
  }

  function spawnWave(w){
    for(const s of w.spawns||[]){
      const count=s.count||1;
      for(let i=0;i<count;i++){
        const ox=(i%4)*18, oy=Math.floor(i/4)*18;
        spawnCreature(s.type||'default', (s.x||0)+ox, (s.y||0)+oy, s.zoneId||w.zoneId||null);
      }
    }
    const z=zoneById(w.zoneId);
    if(z){ z._everSpawned=true; z._clearAnnounced=false; }
    call(api, 'onWaveSpawn', w, {mode:'battlefield'});
  }

  function updateWaves(){
    for(const w of waves){
      if(w.done||elapsed<(w.at||0))continue;
      w.done=true; spawnWave(w);
    }
  }

  function movePlayer(dt, input){
    const mx=(inputDown(input,'right','moveRight')?1:0)-(inputDown(input,'left','moveLeft')?1:0);
    const my=(inputDown(input,'down','moveDown')?1:0)-(inputDown(input,'up','moveUp')?1:0);
    if(mx||my){
      const n=norm(mx,my);
      player.vx+=n.x*cfg.accel*dt; player.vy+=n.y*cfg.accel*dt;
      player.dirX=n.x; player.dirY=n.y;
    }else{
      const f=cfg.friction*dt;
      const vx=Math.abs(player.vx), vy=Math.abs(player.vy);
      player.vx=vx<=f?0:player.vx-Math.sign(player.vx)*f;
      player.vy=vy<=f?0:player.vy-Math.sign(player.vy)*f;
    }
    const sp=Math.hypot(player.vx,player.vy);
    if(sp>cfg.speed){ player.vx=player.vx/sp*cfg.speed; player.vy=player.vy/sp*cfg.speed; }
    player.x=clamp(player.x+player.vx*dt, player.r, (level.width||1000)-player.r);
    player.y=clamp(player.y+player.vy*dt, player.r, (level.height||700)-player.r);
    player.moving=Math.abs(player.vx)>4||Math.abs(player.vy)>4;
  }

  function melee(input){
    if(player.attackCd>0)return;
    if(!(input.attackPressed||input.attack||input.confirmPressed))return;
    if(!spend('melee', {mode:'battlefield'}))return;
    player.attackCd=cfg.attackCd;
    attackBox={x:player.x+player.dirX*cfg.attackRange, y:player.y+player.dirY*cfg.attackRange, r:cfg.attackRange, t:.12};
    const dmg=meleeDamage();
    for(const c of creatures){
      if(c.dead||dist(c, player)>cfg.attackRange+c.r+8)continue;
      c.hp-=dmg; c.hitFlash=.11;
      call(api, 'onMeleeHit', c, {mode:'battlefield', damage:dmg});
      if(c.hp<=0){
        c.dead=true;
        call(api, 'onCreatureDefeated', c, {mode:'battlefield'});
      }
    }
    for(const r of rivals){
      if(r.dead||dist(r, player)>cfg.attackRange+r.r+8)continue;
      r.hp-=dmg; r.hitFlash=.12;
      call(api, 'onMeleeHit', r, {mode:'battlefield', damage:dmg, rival:true});
      if(r.hp<=0)killRival(r,'player');
    }
    if(duel&&duel.status==='active'&&duel.peer&&dist(duel.peer, player)<cfg.attackRange+14){
      send({t:PVP_TYPES.hit, duelId:duel.id, to:duel.peerId, amount:dmg, at:elapsed});
    }
  }

  function updateCreatures(dt){
    for(const c of creatures){
      if(c.dead)continue;
      if(c.attackCd>0)c.attackCd=Math.max(0,c.attackCd-dt);
      if(c.hitFlash>0)c.hitFlash=Math.max(0,c.hitFlash-dt);
      const z=zoneById(c.zoneId);
      if(z&&z.safeUntil>elapsed)continue;
      const d=dist(c, player);
      if(d>c.reach){
        const n=norm(player.x-c.x, player.y-c.y);
        c.x+=n.x*c.speed*dt; c.y+=n.y*c.speed*dt;
      }else if(c.attackCd<=0){
        c.attackCd=.8;
        damage(c.damage, c);
      }
    }
    creatures=creatures.filter(c=>!c.dead||c.hitFlash>0);
  }

  function updateZones(dt){
    for(const z of zones){
      const alive=creatures.some(c=>!c.dead&&c.zoneId===z.id);
      if(z._everSpawned&&!alive&&!z._clearAnnounced){
        z._clearAnnounced=true;
        z.safeUntil=elapsed+(z.clearFor||12);
        call(api, 'onZoneCleared', z.id, {mode:'battlefield', zone:z});
      }
      if(z.safeUntil>elapsed&&pointInZone(player,z)&&api&&api.player&&typeof api.player.regen==='function'){
        api.player.regen(z.regen||1, dt, {mode:'battlefield', zone:z});
      }
    }
  }

  function livingRivals(){ let n=0; for(const r of rivals)if(!r.dead)n++; return n; }
  function recomputeRemaining(){ remaining=1+livingRivals(); }
  function inStorm(x,y){ return !!storm && Math.hypot(x-storm.cx,y-storm.cy)>storm.r; }

  function updateStorm(dt){
    if(!storm)return;
    storm.pulse+=dt;
    if(elapsed>storm.start && storm.r>storm.rMin) storm.r=Math.max(storm.rMin, storm.r-storm.rate*dt);
    if(inStorm(player.x,player.y)){
      stormTick+=dt;
      if(stormTick>=.5){ stormTick=0; if(api&&api.player&&typeof api.player.damage==='function')api.player.damage(storm.dps*.5,{type:'storm'}); }
    } else stormTick=0;
    for(const c of creatures){ if(!c.dead&&inStorm(c.x,c.y)){ c.hp-=storm.dps*dt; if(c.hp<=0)c.dead=true; } }
    for(const r of rivals){ if(!r.dead&&inStorm(r.x,r.y)){ r.hp-=storm.dps*dt; if(r.hp<=0)killRival(r,'storm'); } }
  }

  function fireProjectile(from, tx, ty, team, opt={}){
    const n=norm(tx-from.x, ty-from.y), sp=opt.speed||220;
    projectiles.push({ x:from.x, y:from.y, vx:n.x*sp, vy:n.y*sp, r:opt.r||5, dmg:opt.dmg||5, team,
      life:opt.life||2.6, color:opt.color||'#d7d0a2', t:0 });
  }

  function nearestEnemyOf(r){
    let bd=1e9, bt=null;
    const consider=(x,y,team,ref)=>{ const d=Math.hypot(x-r.x,y-r.y); if(d<bd){ bd=d; bt={team,ref,x,y,d}; } };
    consider(player.x,player.y,'player',null);
    for(const o of rivals)if(o!==r&&!o.dead)consider(o.x,o.y,'rival',o);
    for(const c of creatures)if(!c.dead)consider(c.x,c.y,'creature',c);
    return bt;
  }

  function killRival(r, by){
    if(r.dead)return;
    r.dead=true; r.hitFlash=.14;
    recomputeRemaining();
    if(by==='player'){ kills++; call(api,'onCreatureDefeated',{id:r.id,key:'rival',name:r.name,reward:r.reward},{mode:'battlefield',rival:r,reward:r.reward}); }
    banner={ text:(by==='player'?'You downed '+r.name:r.name+' fell')+'   —   '+remaining+' remain', t:2.6 };
    if(remaining<=1) banner={ text:'LAST RECORDED STANDING', t:4 };
  }

  function updateRivals(dt){
    for(const r of rivals){
      if(r.dead)continue;
      if(r.attackCd>0)r.attackCd-=dt;
      if(r.fireCd>0)r.fireCd-=dt;
      if(r.hitFlash>0)r.hitFlash=Math.max(0,r.hitFlash-dt);
      const dC=storm?Math.hypot(r.x-storm.cx,r.y-storm.cy):0;
      let tx, ty, tgt=null;
      if(storm&&dC>storm.r-28){ tx=storm.cx; ty=storm.cy; }
      else { tgt=nearestEnemyOf(r); tx=tgt?tgt.x:(storm?storm.cx:player.x); ty=tgt?tgt.y:(storm?storm.cy:player.y); }
      const n=norm(tx-r.x,ty-r.y);
      r.dirX=n.x; r.dirY=n.y;
      r.x=clamp(r.x+n.x*r.speed*dt, r.r, (level.width||1000)-r.r);
      r.y=clamp(r.y+n.y*r.speed*dt, r.r, (level.height||700)-r.r);
      if(!tgt)continue;
      if(r.ranged&&r.fireCd<=0&&tgt.d<320&&tgt.d>46){
        r.fireCd=1.4+Math.random()*0.7;
        fireProjectile(r, tgt.x, tgt.y, 'rival', {dmg:r.dmg, speed:205, color:r.tint, r:5});
      } else if(tgt.d<r.r+18&&r.attackCd<=0){
        r.attackCd=.7;
        if(tgt.team==='player')damage(r.dmg, r);
        else if(tgt.team==='rival'){ tgt.ref.hp-=r.dmg; tgt.ref.hitFlash=.1; if(tgt.ref.hp<=0)killRival(tgt.ref,'rival'); }
        else if(tgt.team==='creature'){ tgt.ref.hp-=r.dmg; tgt.ref.hitFlash=.1; if(tgt.ref.hp<=0)tgt.ref.dead=true; }
      }
    }
  }

  function updateProjectiles(dt){
    const W=level.width||1000, H=level.height||700;
    for(const p of projectiles){
      p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt; p.t+=dt;
      if(p.life<=0)continue;
      if(p.team!=='player'&&Math.hypot(p.x-player.x,p.y-player.y)<player.r+p.r){ damage(p.dmg,{type:'projectile'}); p.life=0; continue; }
      if(p.team==='player'){
        for(const c of creatures){ if(!c.dead&&Math.hypot(p.x-c.x,p.y-c.y)<c.r+p.r){ c.hp-=p.dmg; c.hitFlash=.1; if(c.hp<=0)c.dead=true; p.life=0; break; } }
      }
    }
    projectiles=projectiles.filter(p=>p.life>0&&p.x>-40&&p.y>-40&&p.x<W+40&&p.y<H+40);
  }

  function updateCamera(){
    camera.x=clamp(player.x-camera.w/2, 0, Math.max(0,(level.width||camera.w)-camera.w));
    camera.y=clamp(player.y-camera.h/2, 0, Math.max(0,(level.height||camera.h)-camera.h));
    if(api&&api.camera){ api.camera.x=camera.x; api.camera.y=camera.y; api.camera.w=camera.w; api.camera.h=camera.h; }
  }

  function challengePeer(peerId){
    if(!peerId)return null;
    const id='duel-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
    duel={id, peerId, status:'challenged', startedAt:elapsed, peer:null, result:null};
    send({t:PVP_TYPES.challenge, duelId:id, to:peerId, areaId:level.id||level.name||'battlefield'});
    call(api, 'log', 'Duel challenge sent to '+peerId+'.');
    return id;
  }

  function acceptDuel(duelId){
    const ch=pending[duelId];
    if(!ch)return false;
    duel={id:duelId, peerId:ch.from, status:'active', startedAt:elapsed, peer:null, result:null};
    delete pending[duelId];
    send({t:PVP_TYPES.accept, duelId, to:duel.peerId});
    call(api, 'onDuelAccepted', {t:PVP_TYPES.accept, duelId, from:duel.peerId, to:localId()}, {mode:'battlefield', acceptedBy:localId()});
    call(api, 'log', 'Duel accepted: '+duelId+'.');
    return true;
  }

  function declineDuel(duelId, reason='declined'){
    const ch=pending[duelId];
    if(!ch)return false;
    delete pending[duelId];
    send({t:PVP_TYPES.decline, duelId, to:ch.from, reason});
    return true;
  }

  function forfeitDuel(){
    if(!duel||duel.status!=='active')return false;
    send({t:PVP_TYPES.forfeit, duelId:duel.id, to:duel.peerId});
    finishDuel({duelId:duel.id, winner:duel.peerId, loser:localId(), reason:'forfeit'});
    return true;
  }

  function finishDuel(result){
    if(!duel||duel.id!==result.duelId)duel={id:result.duelId, peerId:result.winner, status:'result'};
    duel.status='result'; duel.result=result;
    call(api, 'onDuelResult', result, {mode:'battlefield'});
    call(api, 'log', 'Duel resolved: '+(result.reason||'result')+'.');
  }

  function onChallenge(m){
    if(m.from===localId())return;
    if(m.to&&m.to!==localId())return;
    pending[m.duelId]=m;
    call(api, 'onDuelChallenge', m, {mode:'battlefield'});
    call(api, 'log', 'Incoming duel challenge from '+m.from+'.');
  }

  function onAccept(m){
    if(!duel||m.duelId!==duel.id)return;
    if(m.to&&m.to!==localId())return;
    duel.status='active'; duel.peerId=m.from||duel.peerId; duel.startedAt=elapsed;
    call(api, 'onDuelAccepted', m, {mode:'battlefield'});
    call(api, 'log', 'Duel accepted by '+duel.peerId+'.');
  }

  function onDecline(m){
    if(!duel||m.duelId!==duel.id)return;
    duel.status='declined'; duel.result={duelId:m.duelId, reason:m.reason||'declined'};
    call(api, 'log', 'Duel declined.');
  }

  function onPeerState(m){
    if(!duel||m.duelId!==duel.id||m.from===localId())return;
    duel.peer={x:m.x||0,y:m.y||0,hp:m.hp,stamina:m.stamina};
  }

  function onPeerHit(m){
    if(!duel||m.duelId!==duel.id||m.to!==localId())return;
    damage(m.amount||0, {type:'duel', from:m.from});
  }

  function onForfeit(m){
    if(!duel||m.duelId!==duel.id)return;
    finishDuel({duelId:m.duelId, winner:localId(), loser:m.from, reason:'forfeit'});
  }

  function onResult(m){
    if(!m.duelId)return;
    finishDuel(m);
  }

  function updateDuel(dt){
    if(!duel||duel.status!=='active')return;
    stateSend+=dt;
    if(stateSend>.1){
      stateSend=0;
      const p=api&&api.player||{};
      send({t:PVP_TYPES.state, duelId:duel.id, to:duel.peerId, x:player.x, y:player.y, hp:p.hp, stamina:p.sta||p.stamina});
    }
  }

  function update(dt, input={}){
    if(!player)return;
    dt=Math.min(dt||0, .05); elapsed+=dt;
    if(player.hurtCd>0)player.hurtCd=Math.max(0,player.hurtCd-dt);
    if(player.attackCd>0)player.attackCd=Math.max(0,player.attackCd-dt);
    if(attackBox){ attackBox.t-=dt; if(attackBox.t<=0)attackBox=null; }
    if(banner&&banner.t>0)banner.t-=dt;
    updateWaves();
    movePlayer(dt, input);
    melee(input);
    updateCreatures(dt);
    updateRivals(dt);
    updateProjectiles(dt);
    updateStorm(dt);
    updateZones(dt);
    if(input.challengePressed||input.challenge)challengePeer(input.peerId||'stub-peer');
    if(input.forfeitPressed||input.forfeit)forfeitDuel();
    updateDuel(dt);
    updateCamera();
    syncHost();
  }

  function drawRect(c, cam, r, color){
    c.fillStyle=color;
    c.fillRect(Math.round(r.x-cam.x), Math.round(r.y-cam.y), Math.round(r.w), Math.round(r.h));
  }

  function drawCircle(c, cam, x, y, r, color){
    c.fillStyle=color;
    c.beginPath(); c.arc(Math.round(x-cam.x), Math.round(y-cam.y), r, 0, Math.PI*2); c.fill();
  }

  function render(nextCtx=ctx, nextCamera){
    const c=nextCtx||ctx; if(!c||!player)return;
    if(nextCamera){ nextCamera.x=camera.x; nextCamera.y=camera.y; nextCamera.w=camera.w; nextCamera.h=camera.h; }
    const cam=nextCamera||camera;
    const spr=api&&api.assets&&api.assets.drawSheet;
    const outside=inStorm(player.x,player.y);
    c.save();
    c.imageSmoothingEnabled=false;
    c.fillStyle='#101619'; c.fillRect(0,0,cam.w,cam.h);
    c.fillStyle='#1f2a24';
    for(let x=-((cam.x%40)+40); x<cam.w; x+=40)c.fillRect(x,0,1,cam.h);
    for(let y=-((cam.y%40)+40); y<cam.h; y+=40)c.fillRect(0,y,cam.w,1);

    // Ledger storm: tint everything OUTSIDE the safe ring (even-odd = rect minus circle hole)
    if(storm){
      const sx=storm.cx-cam.x, sy=storm.cy-cam.y, rr=Math.max(0,storm.r);
      c.beginPath();
      c.rect(0,0,cam.w,cam.h);
      c.arc(sx,sy,rr,0,Math.PI*2);
      c.fillStyle='rgba(116,28,150,.46)';
      c.fill('evenodd');
      // inner danger glow just inside the storm edge
      c.beginPath();
      c.rect(0,0,cam.w,cam.h);
      c.arc(sx,sy,rr+26,0,Math.PI*2);
      c.fillStyle='rgba(150,50,180,.22)';
      c.fill('evenodd');
    }

    // Safe regen zones (lightened so they don't fight the storm)
    for(const z of zones){
      if(z.safeUntil<=elapsed)continue;
      drawRect(c, cam, z, 'rgba(83,136,102,.28)');
      c.strokeStyle='#75c893'; c.lineWidth=2;
      c.strokeRect(Math.round(z.x-cam.x), Math.round(z.y-cam.y), z.w, z.h);
    }

    // Storm ring boundary (pulsing)
    if(storm){
      const sx=storm.cx-cam.x, sy=storm.cy-cam.y, pulse=1+Math.sin(storm.pulse*4)*0.04;
      c.strokeStyle='rgba(150,60,180,.35)'; c.lineWidth=9; c.beginPath(); c.arc(sx,sy,Math.max(0,storm.r),0,Math.PI*2); c.stroke();
      c.strokeStyle='rgba(222,130,242,.95)'; c.lineWidth=2.5; c.beginPath(); c.arc(sx,sy,Math.max(0,storm.r*pulse),0,Math.PI*2); c.stroke();
    }

    for(const cr of creatures){
      if(cr.dead&&cr.hitFlash<=0)continue;
      drawCircle(c, cam, cr.x, cr.y, cr.r+4, 'rgba(0,0,0,.32)');
      if(!(spr&&spr(cr.asset||cr.key, cr.x, cr.y+cr.r, cr.hitFlash>0?3:1, cr.scale||1)))
        drawCircle(c, cam, cr.x, cr.y, cr.r, cr.hitFlash>0?'#f4eee0':cr.color);
      if(cr.hp<cr.maxHp){
        const w=cr.r*2+8, x=Math.round(cr.x-cam.x-w/2), y=Math.round(cr.y-cam.y-cr.r-10);
        c.fillStyle='#08090a'; c.fillRect(x,y,w,3);
        c.fillStyle='#c95b52'; c.fillRect(x+1,y+1,(w-2)*Math.max(0,cr.hp/cr.maxHp),1);
      }
    }

    // Rival Recorded — the other combatants in the royale
    for(const rv of rivals){
      if(rv.dead&&rv.hitFlash<=0)continue;
      drawCircle(c, cam, rv.x, rv.y+5, 11, 'rgba(0,0,0,.34)');
      if(!(spr&&spr(rv.asset, rv.x, rv.y+rv.r+2, rv.hitFlash>0?3:0, 1, {flipX:rv.dirX<0})))
        drawCircle(c, cam, rv.x, rv.y, rv.r, rv.hitFlash>0?'#ffffff':rv.tint);
      c.strokeStyle=rv.tint; c.lineWidth=2; c.beginPath(); c.arc(Math.round(rv.x-cam.x),Math.round(rv.y-cam.y),rv.r+3,0,Math.PI*2); c.stroke();
      if(!rv.dead){
        c.fillStyle='#d8d2c4'; c.font='8px monospace'; c.textAlign='center';
        c.fillText(rv.name, Math.round(rv.x-cam.x), Math.round(rv.y-cam.y-rv.r-10));
        const w=rv.r*2+10, x=Math.round(rv.x-cam.x-w/2), y=Math.round(rv.y-cam.y-rv.r-8);
        c.fillStyle='#08090a'; c.fillRect(x,y,w,3);
        c.fillStyle=rv.tint; c.fillRect(x+1,y+1,(w-2)*Math.max(0,rv.hp/rv.maxHp),1);
        c.textAlign='left';
      }
    }

    for(const p of projectiles){
      drawCircle(c, cam, p.x, p.y, p.r+1.5, 'rgba(0,0,0,.25)');
      drawCircle(c, cam, p.x, p.y, p.r, p.color||'#d7d0a2');
    }

    if(attackBox)drawCircle(c, cam, attackBox.x, attackBox.y, attackBox.r, 'rgba(241,230,200,.22)');
    if(duel&&duel.peer){
      drawCircle(c, cam, duel.peer.x, duel.peer.y, 13, 'rgba(150,180,255,.25)');
      drawCircle(c, cam, duel.peer.x, duel.peer.y, 8, '#9eb4ff');
    }
    drawCircle(c, cam, player.x, player.y+5, 13, 'rgba(0,0,0,.35)');
    if(!(spr&&spr('player', player.x, player.y+player.r+2, player.moving?1:0, 1))){
      drawCircle(c, cam, player.x, player.y, player.r, '#7187d6');
      c.fillStyle='#e4cdae'; c.fillRect(Math.round(player.x-cam.x-5), Math.round(player.y-cam.y-17), 10, 8);
      c.fillStyle='#f2d37f';
      c.fillRect(Math.round(player.x-cam.x+player.dirX*11-2), Math.round(player.y-cam.y+player.dirY*11-2), 4, 4);
    }
    if(outside){
      c.strokeStyle='rgba(226,120,240,.85)'; c.lineWidth=2;
      c.beginPath(); c.arc(Math.round(player.x-cam.x),Math.round(player.y-cam.y),player.r+5+Math.sin(elapsed*10)*1.5,0,Math.PI*2); c.stroke();
    }

    // HUD — royale roster + storm state
    c.textAlign='center';
    c.fillStyle='#0c0c10'; c.fillRect(cam.w/2-94, 6, 188, 22);
    c.fillStyle='#f0e6d0'; c.font='bold 15px monospace';
    c.fillText(remaining+' RECORDED REMAIN', cam.w/2, 22);
    if(storm){
      c.font='10px monospace';
      if(outside){ c.fillStyle='#ff7ad0'; c.fillText('! OUTSIDE THE LEDGER — you are being unwritten !', cam.w/2, 40); }
      else { c.fillStyle='#cf8ae0'; c.fillText(elapsed<storm.start?('the ledger closes in '+Math.ceil(storm.start-elapsed)+'s'):(storm.r>storm.rMin+1?'the ledger is closing — stay inside the ring':'final ground'), cam.w/2, 40); }
    }
    if(banner&&banner.t>0){
      const a=Math.min(1,banner.t);
      c.fillStyle='rgba(0,0,0,'+(0.55*a)+')'; c.fillRect(cam.w/2-145, cam.h-44, 290, 22);
      c.fillStyle='rgba(236,217,168,'+a+')'; c.font='bold 11px monospace';
      c.fillText(banner.text, cam.w/2, cam.h-29);
    }
    c.textAlign='left';
    c.fillStyle='#9aa0a6'; c.font='10px monospace';
    c.fillText('downs '+kills+(creatures.filter(cr=>!cr.dead).length?'   wildlife '+creatures.filter(cr=>!cr.dead).length:''), 12, cam.h-12);
    c.restore();
  }

  return {
    enter, exit, update, render,
    challengePeer, acceptDuel, declineDuel, forfeitDuel,
    getState(){
      const wavesDone=!waves.length||waves.every(w=>w.done);
      const noCreatures=creatures.filter(c=>!c.dead).length===0;
      const hadRivals=rivals.length>0;
      const noRivals=livingRivals()===0;
      // Battle royale: you win by being the last Recorded standing (all rivals down).
      // Levels with rivals disabled fall back to the classic survive-the-waves clear.
      return {player,camera,zones,waves,creatures,rivals,storm,projectiles,remaining,kills,duel,pending,elapsed,
        complete: hadRivals ? noRivals : (wavesDone&&noCreatures)};
    }
  };
}
