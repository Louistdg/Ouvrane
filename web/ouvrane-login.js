/* The login and application share the same explicit browser preference. */
(()=>{'use strict';
const themes={'repere-eclipse':['eclipse','01-eclipse'],'petrole':['petrole','01-eclipse'],'repere-cuivre':['cuivre','02-cuivre'],'repere-lunaire':['lunaire','03-lunaire'],'repere-amethyste':['amethyste','02-cuivre'],'repere-opaline':['opaline','02-cuivre']};
let selected='petrole';
try{const saved=localStorage.getItem('socle-v3.theme');if(Object.hasOwn(themes,saved)&&localStorage.getItem('socle-v3.theme-choice')==='explicit')selected=saved}catch{}
const picker=document.querySelector('#login-theme');
function apply(id,explicit=false){if(!Object.hasOwn(themes,id))return;document.documentElement.className='theme-'+themes[id][0];picker.value=id;document.querySelector('.brand img').src='/ouvrane-'+themes[id][1]+'.png';document.querySelector('meta[name="theme-color"]').content=getComputedStyle(document.documentElement).getPropertyValue('--deep').trim();try{localStorage.setItem('socle-v3.theme',id);if(explicit)localStorage.setItem('socle-v3.theme-choice','explicit')}catch{}}
apply(selected);picker.addEventListener('change',()=>apply(picker.value,true));
})();
(()=>{'use strict';const form=document.querySelector('#connection-form'),password=document.querySelector('#password'),toggle=document.querySelector('#password-toggle'),status=document.querySelector('#form-status'),submit=form.querySelector('[type=submit]');
toggle.addEventListener('click',()=>{const visible=password.type==='password';password.type=visible?'text':'password';toggle.setAttribute('aria-pressed',String(visible));toggle.setAttribute('aria-label',visible?'Masquer le mot de passe':'Afficher le mot de passe');toggle.title=toggle.getAttribute('aria-label')});
const assistance=document.querySelector('#assistance'),help=[...document.querySelectorAll('#recovery-button,#help-button')];let opener;
function closeHelp(){assistance.hidden=true;help.forEach(b=>b.setAttribute('aria-expanded','false'));opener?.focus()}
help.forEach(b=>b.addEventListener('click',()=>{opener=b;assistance.hidden=false;help.forEach(x=>x.setAttribute('aria-expanded','true'));assistance.focus()}));document.querySelector('#close-assistance').addEventListener('click',closeHelp);assistance.addEventListener('keydown',e=>{if(e.key==='Escape')closeHelp()});
form.addEventListener('submit',async event=>{event.preventDefault();if(submit.disabled)return;submit.disabled=true;status.hidden=false;status.textContent='Connexion en cours…';try{const result=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:form.elements.email.value.trim(),password:password.value})});if(result.ok){location.replace('/');return}status.textContent=result.status===429?'Trop de tentatives. Patientez avant de réessayer.':result.status===401?'Connexion refusée. Vérifiez votre adresse e-mail et votre mot de passe.':'La connexion est momentanément indisponible. Réessayez dans un instant.'}catch{status.textContent='La connexion au serveur a été interrompue. Vérifiez votre connexion puis réessayez.'}finally{submit.disabled=false}});
})();
