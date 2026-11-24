const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function invitationEmail(input,env){
 const origin=new URL(env.SOCLE_PUBLIC_URL);
 if(origin.protocol!=='https:'||origin.username||origin.password)throw Error('Origine d’invitation invalide.');
 if(typeof input.token!=='string'||input.token.length<20||input.token.length>200)throw Error('Jeton d’invitation invalide.');
 const expires=new Date(input.expiresAt);if(!Number.isFinite(expires.getTime()))throw Error('Date d’expiration invalide.');
 const expiry=new Intl.DateTimeFormat('fr-BE',{timeZone:'Europe/Brussels',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(expires)+' (heure de Bruxelles)';
 const from=String(env.SOCLE_EMAIL_FROM||'').trim();if(!from||/[\r\n]/.test(from))throw Error('Expéditeur invalide.');
 const organization=String(input.organizationName||'votre entreprise'),role=String(input.roleName||'collaborateur'),person=String(input.personName||'').trim();
 const activation=new URL('/invite/activate',origin);activation.hash=input.token;
 const link=activation.href,greeting=person?'Bonjour '+person+',':'Bonjour,';
 const subjectOrganization=organization.replace(/[\r\n]+/g,' ').slice(0,120);
 const text=[greeting,'',`Vous avez reçu une invitation à rejoindre ${organization} dans OUVRANE avec le rôle ${role}.`,'','Activer votre accès à OUVRANE :',link,'',`Ce lien personnel expire le ${expiry}.`,'',`Site officiel : ${origin.origin}`,'Si vous n’attendiez pas cette invitation, ignorez ce message.'].join('\n');
 const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Votre invitation OUVRANE</title></head><body style="margin:0;padding:24px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#183a36;background:#f5f3ec"><main style="max-width:560px;margin:auto"><p style="font-weight:bold;letter-spacing:1px">OUVRANE</p><p>${escapeHtml(greeting)}</p><p>Vous avez reçu une invitation à rejoindre <strong>${escapeHtml(organization)}</strong> avec le rôle <strong>${escapeHtml(role)}</strong>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#183a36;color:#fff;text-decoration:none">Activer votre accès à OUVRANE</a></p><p>Ce lien personnel expire le <strong>${escapeHtml(expiry)}</strong>.</p><p>Site officiel : ${escapeHtml(origin.origin)}</p><p style="font-size:14px;color:#465f5b">Si vous n’attendiez pas cette invitation, ignorez ce message.</p></main></body></html>`;
 const payload={from:from.includes('<')?from:`OUVRANE <${from}>`,to:[input.to],subject:`OUVRANE — Invitation à rejoindre ${subjectOrganization}`,text,html};
 if(env.SOCLE_EMAIL_REPLY_TO){const reply=String(env.SOCLE_EMAIL_REPLY_TO).trim();if(/[\r\n]/.test(reply))throw Error('Adresse de réponse invalide.');payload.reply_to=reply;}
 return payload;
}
