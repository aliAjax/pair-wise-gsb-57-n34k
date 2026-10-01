import { RequestDetailPage } from '@/features/RequestDetailPage'

export default function RequestDetailRoute({ params }: { params: { id: string } }) {
  return <RequestDetailPage requestId={params.id} />
}
