import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { adminBtnRelated } from '@/admin/adminClassNames'

export function AdminRelatedLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className={adminBtnRelated}>
      {children}
      <ArrowUpRight className="h-4 w-4" aria-hidden />
    </Link>
  )
}
