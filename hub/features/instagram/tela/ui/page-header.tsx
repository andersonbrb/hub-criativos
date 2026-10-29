import type { ReactNode } from 'react';

import { PageHeader as CabecalhoDoHub } from '@/components/page-header';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** O cabeçalho das telas do Instagram, o mesmo das outras telas do hub ("Instagram" em cinza acima do título). */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={className ?? 'mb-6'}>
      <CabecalhoDoHub eyebrow="Instagram" title={title} description={description}>
        {actions}
      </CabecalhoDoHub>
    </div>
  );
}
