import type { Route } from './+types/rr-poc';
import { CardsFactory } from '../features/factory/CardsFactory';

export const meta: Route.MetaFunction = () => [
  { title: 'Cards Factory - Three LANS' }
];

export default function ReactCardsFactoryRoute() {
  return <CardsFactory />;
}
