import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CardReader } from './CardReader';
import type { CardDocument } from './card-document';
import cardDocument from './generated-card-document.json';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CardReader document={cardDocument as CardDocument} />
  </StrictMode>,
);
