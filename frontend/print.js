/* Deterministic four-page PDF. The preview and download use these same bytes. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BulletinPrint=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const normalize=s=>String(s??'').normalize('NFC').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
  async function fetchBytes(path){const r=await fetch(path);if(!r.ok)throw Error('인쇄 자료를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');return new Uint8Array(await r.arrayBuffer());}
  // A small TTF metrics adapter. Glyph IDs and advances come from the embedded
  // font itself. NFC Korean/Latin are supported; this is not a complex-script shaper.
  function fontAdapter(m){
    const glyph=cp=>({id:m.cmap[cp]||0,advanceWidth:m.widths[m.cmap[cp]||0],codePoints:[cp]});
    return {...m,postscriptName:'KPCSTL-'+m.id,characterSet:Object.keys(m.cmap).map(Number),
      italicAngle:0,xHeight:m.unitsPerEm/2,post:{isFixedPitch:false},head:{macStyle:{italic:false}},
      glyphForCodePoint:glyph,layout:text=>({glyphs:Array.from(text,c=>glyph(c.codePointAt(0)))})};
  }
  // The advance width is not the ink boundary: e.g. j and accented fallback
  // glyphs can extend outside their advance. Read the embedded TrueType outlines
  // so wrapping and baseline placement use the same glyphs as the exported PDF.
  function glyphBounds(bytes,metrics){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tables={};
    for(let n=0;n<view.getUint16(4);n++){
      const at=12+n*16,tag=String.fromCharCode(...bytes.slice(at,at+4));
      tables[tag]=view.getUint32(at+8);
    }
    if(!tables.glyf||!tables.loca||!tables.head)return metrics.widths.map(()=>metrics.bbox);
    const long=view.getInt16(tables.head+50)===1;
    const offset=n=>long?view.getUint32(tables.loca+n*4):view.getUint16(tables.loca+n*2)*2;
    return metrics.widths.map((_,n)=>{
      const begin=offset(n),end=offset(n+1);
      if(begin===end)return null;
      const at=tables.glyf+begin;
      return {minX:view.getInt16(at+2),minY:view.getInt16(at+4),maxX:view.getInt16(at+6),maxY:view.getInt16(at+8)};
    });
  }
  async function generate(issue,options={}){
    const L=options.PDFLib||globalThis.PDFLib,read=options.load||fetchBytes;
    if(!L)throw Error('PDF 도구를 불러오지 못했습니다. 새로고침해 주세요.');
    const [template,metricsBytes]=await Promise.all([read('assets/print/template.pdf'),read('assets/print/font-metrics.json')]);
    const metrics=JSON.parse(new TextDecoder().decode(metricsBytes));
    const doc=await L.PDFDocument.load(template),pages=doc.getPages(),fonts={},outlines={};
    const fontBytes=await Promise.all(Object.values(metrics).map(m=>read(m.url)));
    for(const [n,m]of Object.values(metrics).entries()){
      outlines[m.id]=glyphBounds(fontBytes[n],m);
      doc.registerFontkit({create:()=>fontAdapter(m)});
      fonts[m.id]=await doc.embedFont(fontBytes[n],{subset:false,customName:'KPCSTL-'+m.id});
    }
    const warnings=[],layout=[],seen=new Set(),fallbackChars=new Set();
    const ink=L.rgb(.08,.09,.1),navy=L.rgb(.21,.30,.38),gray=L.rgb(.84,.85,.85),white=L.rgb(1,1,1),red=L.rgb(.75,.12,.16);
    const warn=(id,label,section,message,blocking=true)=>{const key=id+message;if(!seen.has(key)){seen.add(key);warnings.push({id,label,section,message,blocking});}};
    function fontFor(c,preferred,region){
      const cp=c.codePointAt(0);
      if(metrics[preferred].cmap[cp])return preferred;
      if(metrics.regular.cmap[cp])return 'regular';
      if(metrics.fallback.cmap[cp]){fallbackChars.add(c);return 'fallback';}
      warn(region.id,region.label,region.section,'지원하지 않는 문자가 있습니다: '+c+' — 다른 문자로 바꿔 주세요.');
      return 'fallback';
    }
    function runs(text,font,region){
      const result=[];
      for(const c of text){let f=fontFor(c,font,region),ch=metrics[f].cmap[c.codePointAt(0)]?c:'?';const last=result.at(-1);if(last&&last.font===f)last.text+=ch;else result.push({font:f,text:ch});}
      return result;
    }
    function measure(text,font,size,region){
      let advance=0,left=0,right=0,ascent=0,descent=0;
      for(const run of runs(text,font,region))for(const c of run.text){
        const m=metrics[run.font],id=m.cmap[c.codePointAt(0)]||0,b=outlines[run.font][id],scale=size/m.unitsPerEm;
        if(b){left=Math.min(left,advance+b.minX*scale);right=Math.max(right,advance+b.maxX*scale);ascent=Math.max(ascent,b.maxY*scale);descent=Math.max(descent,-b.minY*scale);}
        advance+=m.widths[id]*scale;
      }
      return {advance,left,right,ascent,descent,width:Math.max(advance,right)-left};
    }
    function wrap(text,width,font,size,region){
      const lines=[];
      for(const paragraph of normalize(text).split('\n')){
        let pending=Array.from(paragraph),line='';
        while(pending.length){
          const c=pending.shift(),candidate=line+c;
          if(measure(candidate,font,size,region).width<=width){line=candidate;continue;}
          if(!line){
            warn(region.id,region.label,region.section,'문자 한 개가 인쇄 칸의 너비보다 큽니다. 내용을 확인해 주세요.');
            lines.push(c);continue;
          }
          const space=line.lastIndexOf(' ');
          if(space>0&&space>line.length*.45){
            lines.push(line.slice(0,space).trimEnd());
            // Re-check the remainder, too: a narrow prefix and wide suffix can
            // otherwise leave an overwide line after breaking at a space.
            pending=[...Array.from(line.slice(space+1)),c,...pending];line='';
          }else{lines.push(line.trimEnd());line='';if(c!==' ')pending.unshift(c);}
        }
        lines.push(line.trimEnd());
      }
      return lines;
    }
    function block(text,width,font,size,region,requestedLeading){
      const lines=wrap(text,width,font,size,region),bounds=lines.map(t=>measure(t,font,size,region));
      const ascent=Math.max(size*.86,...bounds.map(b=>b.ascent)),descent=Math.max(size*.14,...bounds.map(b=>b.descent));
      const leading=Math.max(requestedLeading,ascent+descent);
      return {lines,ascent,leading,height:lines.length*leading};
    }
    function line(page,text,x,top,font,size,region,color=ink,geometry={}){
      const m=measure(text,font,size,region),ascent=geometry.ascent??Math.max(size*.86,m.ascent),area=geometry.area;
      if(area)x=Math.max(area.left-m.left,Math.min(x,area.right-Math.max(m.advance,m.right)));
      const baseline=top+ascent,bounds={left:x+m.left,top:baseline-m.ascent,right:x+m.right,bottom:baseline+m.descent};
      if(text&&area&&(bounds.left<area.left-.001||bounds.right>area.right+.001||bounds.top<area.top-.001||bounds.bottom>area.bottom+.001)){
        warn(region.id,region.label,region.section,region.label+' 글자가 인쇄 칸의 경계를 넘습니다. 내용을 줄이거나 확인해 주세요.');
        return;
      }
      if(text)layout.push({...region,page:pages.indexOf(page)+1,text,x,top,font,size,bounds,region:area||{left:0,top:0,right:612,bottom:792}});
      for(const run of runs(text,font,region)){
        page.drawText(run.text,{x,y:792-baseline,font:fonts[run.font],size,color});
        x+=fonts[run.font].widthOfTextAtSize(run.text,size);
      }
    }
    function rect(page,x,y,w,h,color,borderColor,borderWidth=0){page.drawRectangle({x,y:792-y-h,width:w,height:h,...(color?{color}:{}),...(borderColor?{borderColor,borderWidth}:{})});}
    const rule=(page,x,y,w,color=ink,width=.6)=>page.drawLine({start:{x,y:792-y},end:{x:x+w,y:792-y},thickness:width,color});
    function region(page,id,label,section,x,y,w,h,text,opts={}){
      const r={id,label,section},font=opts.font||'regular',size=opts.size||9.96,pad=opts.pad??4;
      const {lines,ascent,leading,height:needed}=block(text,w-pad*2,font,size,r,opts.leading||size*1.36);
      const capacity=Math.max(0,Math.floor((h-pad*2+.000001)/leading));
      if(lines.length>capacity){warn(id,label,section,`${label} 내용이 인쇄 칸을 넘습니다. ${lines.length}줄 중 ${capacity}줄까지 들어갑니다.`);}
      const start=y+pad+(opts.valign==='middle'?Math.max(0,(h-pad*2-needed)/2):0),area={left:x+pad,top:y+pad,right:x+w-pad,bottom:y+h-pad};
      for(const [n,t]of lines.slice(0,capacity).entries()){
        const tw=measure(t,font,size,r).advance,xpos=opts.align==='center'?x+(w-tw)/2:opts.align==='right'?x+w-pad-tw:x+pad;
        line(page,t,xpos,start+n*leading,font,size,r,opts.color||ink,{ascent,area});
      }
      if(lines.length>capacity)rect(page,x,y,w,h,null,red,1.4);
      return needed;
    }
    function simpleRegion(page,id,label,section,x,y,w,h,text,opts={}){
      // Cover old inner grid and any rasterized body text, preserving outer rules.
      rect(page,x+.4,y+.5,w-.8,h-1,white);
      rule(page,x,y,w);rule(page,x,y+h,w);
      return region(page,id,label,section,x,y,w,h,text,opts);
    }
    const i=issue,w=i.worship,s=i.sections,p1=pages[0],p2=pages[1];
    const [yy,mm,dd]=i.date.split('-').map(Number);
    region(p1,'date','주보 날짜','sermon',472,19,100,18,`${yy}년 ${mm}월 ${dd}일`,{size:9.96,pad:1,align:'right'});
    // Worship: preserve every original row and column boundary.
    const worship=(id,y,h,text,opts={})=>region(p1,id,'예배 순서','sermon',50.83,y,246.62,h,text,{align:'center',valign:'middle',pad:2,size:9.7,leading:12,...opts});
    region(p1,'service1','1부 시간','sermon',50.83,159.2,120.11,21.64,'1부 '+w.service1,{align:'center',valign:'middle',size:9.7,pad:2,leading:12,font:'bold'});
    region(p1,'service2','2부 시간','sermon',170.94,159.2,126.51,21.64,'2부 '+w.service2,{align:'center',valign:'middle',size:9.7,pad:2,leading:12,font:'bold'});
    worship('call',180.84,19.2,w.call);worship('doxology',200.04,19.25,w.doxology);worship('confession',219.29,19.3,w.confession);
    for(const [id,x,width,text]of [['hymn1',50.83,120.11,'찬양 (Hymn)\n'+w.hymn1],['praise2',170.94,126.51,'찬양 (Praise & Worship)\n'+w.praise2]])region(p1,id,'찬양','sermon',x,238.59,width,32.57,text,{align:'center',valign:'middle',pad:2,size:9.3,leading:12});
    for(const [id,x,width,text]of [['prayer1',50.83,120.11,w.prayer1],['prayer2',170.94,126.51,w.prayer2]])region(p1,id,'대표기도','sermon',x,271.16,width,41.56,'대표기도 (Prayer)\n'+text,{align:'center',valign:'middle',pad:2,size:9.7,leading:13});
    worship('scripture',312.72,37.23,'성경봉독 (Scripture Reading)\n'+i.sermon.scripture,{leading:13});
    worship('sermon',349.95,76.64,'설교 (Sermon)\n'+i.sermon.title+'\n'+i.sermon.preacher,{font:'bold',leading:14});
    worship('giving',426.59,32.57,'드림과 헌신 (Giving & Dedication)\n'+w.giving);
    worship('notices',459.16,19.29,'교회소식 (Announcements)');
    worship('closing',478.45,19.29,w.closing);worship('benediction',497.74,20.29,w.benediction);
    const roster=i.roster||{};
    const columns=[338.4,394.4,448.6,503.6,558.32];
    for(const [row,keys]of [['dates',['date1','date2','month1','month2']],['first',['prayer11','prayer12','usher11','usher12']],['second',['prayer21','prayer22','usher21','usher22']]]){
      const y=row==='dates'?179.6:row==='first'?202.5:230.5,h=row==='dates'?22.9:row==='first'?28:27.7;
      keys.forEach((key,n)=>region(p1,'roster-'+key,'예배 봉사자','volunteers',columns[n],y,columns[n+1]-columns[n],h,roster[key]||'',{size:9.0,leading:11,pad:2,align:'center',valign:'middle'}));
    }
    simpleRegion(p1,'meals','주일 애찬','volunteers',310.76,279.2,247.55,45.68,'주일 애찬 순서\n'+s.meals,{size:9.5,leading:12,pad:3});
    region(p1,'pastoral','목회 일정','schedule',310.76,355.28,247.55,102.26,s.pastoral,{leading:17});
    region(p1,'events','주요 행사 / 일정','schedule',310.76,485.11,247.55,119.95,s.events,{leading:14});
    const midweek=i.midweek||{};
    for(const [key,x,y]of [['fridayText',364.5,667.6],['saturdayText',461.4,667.6],['fridayLeader',364.5,703.5],['saturdayLeader',461.4,703.5]])region(p1,'midweek-'+key,'주중 집회','schedule',x,y,96.9,36.2,midweek[key]||'',{size:9.6,leading:12,pad:3,align:'center',valign:'middle'});
    // The regular service guide is retained verbatim in the fixed PDF template.
    // Announcements flow into two fixed columns; the original prayer QR is reserved.
    rect(p2,50,397,160,9,L.rgb(.922,.925,.93)); // original rasterized hyperlink underline
    let col=0,top=79;
    for(const [n,a]of i.announcements.entries()){
      const r={id:'announcements',label:'교회 소식',section:'announcements'},title=`${n+1}. ${a.title}`,width=173,size=9.5;
      const tl=block(title,width,'bold',size,r,12.4),bl=block(a.body,width,'regular',size,r,12.4),height=tl.height+bl.height+8;
      if(top+height>(col===0?612:549)&&col===0){col=1;top=79;}
      const bottom=col===0?612:549,x=col===0?50:231;
      if(top+height>bottom){warn('announcements','교회 소식','announcements','교회 소식이 두 단의 인쇄 공간을 넘습니다. 내용을 줄이거나 항목을 정리해 주세요.');rect(p2,x,75,177,bottom-75,null,red,1.4);break;}
      const area={left:x,top:79,right:x+width,bottom};
      for(const t of tl.lines){line(p2,t,x,top,'bold',size,r,ink,{ascent:tl.ascent,area});top+=tl.leading;}
      for(const t of bl.lines){line(p2,t,x,top,'regular',size,r,ink,{ascent:bl.ascent,area});top+=bl.leading;}
      top+=8;
    }
    // Staff information and its original typography remain in the template.
    region(p2,'prayers','함께 기도해 주세요','prayers',40.5,667.51,247.55,107.63,s.prayers,{size:9.5,leading:13,pad:4});
    const keys=['tithe','sunday','thanks','school','mission','scholarship','relief'],labels=['십일조','주일헌금','감사헌금','주일학교','선교헌금','장학헌금','구제헌금'];
    const cents=v=>{const [a,b='']=v.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));};
    const money=v=>'$'+(v/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    const values=keys.map(k=>cents(i.offering[k]));
    labels.push('합계');values.push(values.reduce((a,b)=>a+b,0));
    rect(p2,312.44,667.51,249.15,93.45,white);
    for(let row=0;row<4;row++){
      const y=667.51+row*23.36;
      rule(p2,312.44,y,249.15,gray,.5);
      for(let column=0;column<2;column++){
        const idx=row+column*4,x=312.44+column*124.575;
        rect(p2,x,y,49,23.36,gray);
        region(p2,'offering-'+idx,'헌금 통계','prayers',x,y,49,23.36,labels[idx],{size:8.3,pad:2,align:'center',valign:'middle',leading:10});
        region(p2,'offering-'+idx,'헌금 금액','prayers',x+49,y,75.575,23.36,money(values[idx]),{size:8.3,pad:3,align:'right',valign:'middle',leading:10});
      }
    }
    rule(p2,312.44,760.96,249.15,ink,.6);
    region(pages[2],'question-title','설교 질문 제목','sermon',39,74,534,49,i.sermon.title,{font:'extra',size:20,leading:22,pad:2,align:'center',valign:'middle'});
    region(pages[2],'question-scripture','설교 질문 본문','sermon',39,128,534,23,i.sermon.scripture,{font:'bold',size:14,leading:17,pad:2,align:'center'});
    const onLastPage=q=>Number.isFinite(Number(q.number))&&Number(q.number)>=5;
    const questionGroups=[i.questions.filter(q=>!onLastPage(q)),i.questions.filter(onLastPage)];
    for(const [index,qs]of questionGroups.entries()){
      const page=pages[2+index],start=index===0?158:63,bottom=736,gap=qs.length?Math.min(120,(bottom-start)/qs.length):0;
      let y=start;
      for(const q of qs){
        const r={id:'questions',label:'설교 질문',section:'questions'},text=q.number+'. '+q.body;
        const height=block(text,526,'worksheet',11.6,r,16).height+8;
        if(y+height>bottom){warn('questions','설교 질문','questions','설교 질문이 4쪽 안에 들어가지 않습니다. 질문의 수나 길이를 줄여 주세요.');rect(page,39,start,534,bottom-start,null,red,1.4);break;}
        region(page,'questions','설교 질문','questions',39,y,534,height,text,{font:'worksheet',size:11.6,leading:16,pad:4});
        y+=Math.max(height+24,gap);
      }
    }
    if(fallbackChars.size)warn('font','한글 글꼴','sermon','원본 PDF에 없는 글자는 보완 한글 글꼴로 표시됩니다. 원본과 글자 모양에 차이가 있을 수 있습니다.',false);
    if(i.migrationNotes?.length)warn('migration','이전 입력 확인','volunteers','이전 자유 입력을 표에 반영했는지 확인해 주세요. 기존 내용은 편집 화면에 보존되어 있습니다.');
    const exportable=!warnings.some(w=>w.blocking);
    if(!exportable)for(const page of pages){
      rect(page,154,746,304,13,L.rgb(1,.94,.94));
      line(page,'PREVIEW ONLY - RESOLVE LAYOUT WARNINGS',161,747,'fallback',8.5,{id:'preview',label:'미리보기',section:'sermon'},red);
    }
    doc.setTitle(`KPCSTL ${i.date} v${i.revision}`);doc.setSubject(exportable?'Edited church bulletin':'Layout preview — resolve warnings before export');
    doc.setAuthor('Korean Presbyterian Church of St. Louis');doc.setCreator('KPCSTL Bulletin Studio');
    const bytes=await doc.save();
    return {bytes,warnings,layout,exportable,filename:`KPCSTL-${i.date}-v${i.revision}.pdf`,revision:i.revision,date:i.date,pages:4};
  }
  return {generate,normalize,fontAdapter};
});
