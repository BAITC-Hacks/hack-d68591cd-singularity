import PageContainer from '@/components/layout/page-container';
import { OrgdiffView } from '@/features/orgdiff/components/orgdiff-view';

export const metadata = {
  title: 'Анализ оргструктуры'
};

export default function Page() {
  return (
    <PageContainer
      pageTitle='Анализ оргструктуры и функционала'
      pageDescription='Сравнение комплектов документов «до» и «после» реорганизации. Выводы носят рекомендательный характер: у каждого указан пункт и цитата.'
    >
      <OrgdiffView />
    </PageContainer>
  );
}
