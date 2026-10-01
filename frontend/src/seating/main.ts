import './style.css';
import { mountSuperamberApp } from './embed';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App root not found');
}

mountSuperamberApp(app, { embedded: false });
