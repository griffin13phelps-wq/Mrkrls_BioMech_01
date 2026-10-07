import type { Screen, Work } from './shared';
import { emptyWork } from './shared';

type Renderer = () => void;

export const app: { screen: Screen; work: Work; toast: string | null; render: Renderer } = {
  screen: 'home',
  work: emptyWork(),
  toast: null,
  render: () => {},
};

export function go(screen: Screen): void {
  app.screen = screen;
  app.render();
  window.scrollTo(0, 0);
}

export function rerender(): void {
  const y = window.scrollY;
  app.render();
  window.scrollTo(0, y);
}

export function resetWork(): void {
  app.work.frames?.dispose();
  app.work = emptyWork();
}
