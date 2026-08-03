import type { Route } from './+types/_index';
import { CardsFactory } from '../features/factory/CardsFactory';
import '../styles/factory.css';

export const meta: Route.MetaFunction = () => [
  { title: 'Cards Factory - Three LANS' }
];

export default function CardsFactoryRoute() {
  return <CardsFactory />;
}
