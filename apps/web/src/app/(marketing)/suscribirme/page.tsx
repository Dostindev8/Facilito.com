import { pageMeta } from '@/lib/seo';
import { SubscribeFlow } from './subscribe-flow';

export const metadata = pageMeta({
  title: 'Suscribirme',
  description: 'Elige tu plan de Facilito, paga por transferencia y activamos tu cuenta.',
  path: '/suscribirme',
});

export default function SubscribePage() {
  return (
    <div className="mkt-wrap mkt-page-head checkout" style={{ paddingBottom: 72 }}>
      <h1>Suscríbete a Facilito</h1>
      <p>Elige tu plan, paga por transferencia y te enviamos el enlace para entrar. Sin tarjeta y sin contrato.</p>
      <SubscribeFlow />
    </div>
  );
}
