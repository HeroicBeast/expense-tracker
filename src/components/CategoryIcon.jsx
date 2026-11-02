import {
  Utensils,
  Plane,
  ShoppingCart,
  Cigarette,
  Wine,
  PiggyBank,
  Shapes,
  Home,
  Zap,
  Users,
  ArrowRightLeft,
  Wallet,
  HandCoins,
  UserRound,
} from 'lucide-react';

/** String icon key (stored on the category) → Lucide component. */
const ICONS = {
  Utensils,
  Plane,
  ShoppingCart,
  Cigarette,
  Wine,
  PiggyBank,
  Shapes,
  Home,
  Zap,
  Users,
  ArrowRightLeft,
  Wallet,
  HandCoins,
  UserRound,
};

export default function CategoryIcon({ name, className = 'h-4 w-4' }) {
  const Icon = ICONS[name] || Shapes;
  return <Icon className={className} aria-hidden="true" />;
}
