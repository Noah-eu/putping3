import React from 'react';
import { createRoot } from 'react-dom/client';
import ProfileCard from '../components/ProfileCard.jsx';

let _root = null;
function ensureCardRoot(){
  let host = document.getElementById('pp-card-host');
  if (!host){
    host = document.createElement('div');
    host.id = 'pp-card-host';
    document.body.appendChild(host);
  }
  if (!_root) _root = createRoot(host);
  return _root;
}

export function openProfileCard(profile){
  const root = ensureCardRoot();
  const onClose = () => closeProfileCard();
  root.render(<ProfileCard profile={profile} onClose={onClose} />);
}

export function closeProfileCard(){
  if (_root) _root.render(null);
}

