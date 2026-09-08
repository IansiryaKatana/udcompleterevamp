import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  listStaffAdminLinks,
  linkStaffAdmin,
  listStaffDirectory,
  fetchStaffAliasMatrix,
  resolveStaffAlias,
  listOwnershipBackfillCandidates,
  decideOwnershipCandidate,
  rebuildOwnershipCandidates,
  enrichOwnershipCandidatesPhase5h,
  previewApplyOwnershipCandidates,
  fetchOwnershipReviewPack,
  fetchCrmQualityHub,
  fetchOwnershipCoverage,
  fetchCgCurrentStatePolicy,
  fetchCrmSalesCutoverReadiness,
  fetchStaffDirectoryBaseline,
  fetchOwnershipBaselineReport,
  fetchUnownedAccountReport,
  fetchInactiveStaffOwnershipReport,
  listCustomerCompanyLinkCandidates,
  rebuildCustomerCompanyLinkCandidates,
  decideCustomerCompanyLink,
  listCustomerDuplicateCandidates,
  rebuildCustomerDuplicateCandidates,
  reviewCustomerDuplicate,
  type StaffDirectoryRow,
} from '@/admin/lib/adminRpc'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

export function AdminStaffLinksPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([])
  const [staffId, setStaffId] = useState('')
  const [adminId, setAdminId] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [links, directory] = await Promise.all([listStaffAdminLinks(), listStaffDirectory(true)])
      setData(links)
      setStaff(directory)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load links')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />
  const adminsWithout = (data?.admins_without_staff as Array<Record<string, unknown>>) ?? []
  const linked = (data?.linked as Array<Record<string, unknown>>) ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Exact verified mapping only — no auto-link by similar name. Disabling an admin does not delete staff history.
      </p>
      {canReassignOwnership && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px]">
            <label className={adminLabel}>Staff</label>
            <BrandedSelect
              value={staffId}
              onValueChange={setStaffId}
              allowEmpty
              emptyLabel="Select staff"
              options={staff.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="min-w-[180px]">
            <label className={adminLabel}>Admin (unlinked)</label>
            <BrandedSelect
              value={adminId}
              onValueChange={setAdminId}
              allowEmpty
              emptyLabel="Select admin"
              options={adminsWithout.map((a) => ({
                value: String(a.id),
                label: `${a.email} (${a.role})`,
              }))}
            />
          </div>
          <button
            type="button"
            className={adminBtnPrimary}
            onClick={() =>
              void linkStaffAdmin(staffId, adminId)
                .then(() => {
                  toast.success('Linked')
                  setStaffId('')
                  setAdminId('')
                  return refresh()
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Link failed'))
            }
            disabled={!staffId || !adminId}
          >
            Link
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-[var(--admin-border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Visibility</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {linked.map((r) => (
              <tr key={`${r.staff_id}-${r.admin_id}`} className="border-t border-[var(--admin-border)]">
                <td className="px-3 py-2">{String(r.staff_name)}</td>
                <td className="px-3 py-2 text-[var(--admin-muted)]">
                  {String(r.admin_email)} ({String(r.admin_role)})
                </td>
                <td className="px-3 py-2">{String(r.sales_visibility)}</td>
                <td className="px-3 py-2 text-right">
                  {canReassignOwnership && (
                    <button
                      type="button"
                      className={adminBtnSecondary}
                      onClick={() =>
                        void linkStaffAdmin(String(r.staff_id), String(r.admin_id), true)
                          .then(() => {
                            toast.success('Unlinked')
                            return refresh()
                          })
                          .catch((e) => toast.error(e instanceof Error ? e.message : 'Unlink failed'))
                      }
                    >
                      Unlink
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AdminAliasReviewPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [items, setItems] = useState<Array<Record<string, unknown>>>([])
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [matrix, directory] = await Promise.all([
        fetchStaffAliasMatrix(100, 'UNKNOWN'),
        listStaffDirectory(true),
      ])
      const unknown = (matrix.items as Array<Record<string, unknown>>) ?? []
      const ambiguous = ((await fetchStaffAliasMatrix(100, 'AMBIGUOUS')).items as Array<Record<string, unknown>>) ?? []
      setItems([...unknown, ...ambiguous])
      setStaff(directory)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load aliases')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--admin-muted)]">
        Unresolved aliases only. Decisions retain raw value, source, and counts. Snapshots unchanged.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--admin-muted)]">No UNKNOWN/AMBIGUOUS aliases.</p>
      ) : (
        items.map((a) => (
          <div key={String(a.id)} className="rounded-md border border-[var(--admin-border)] p-3">
            <div className="font-medium">{String(a.raw_value)}</div>
            <div className="text-xs text-[var(--admin-muted)]">
              {String(a.source)} · count {Number(a.occurrence_count)} · {String(a.status)}
            </div>
            {canReassignOwnership && (
              <div className="mt-2 flex flex-wrap gap-2">
                <BrandedSelect
                  value=""
                  onValueChange={(v) =>
                    void resolveStaffAlias(String(a.id), 'RESOLVED', v)
                      .then(() => {
                        toast.success('Resolved')
                        return refresh()
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                  }
                  allowEmpty
                  emptyLabel="Resolve to staff…"
                  options={staff.map((s) => ({ value: s.id, label: s.name }))}
                />
                {(['LEGACY', 'NON_STAFF_REFERRER', 'UNKNOWN'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={adminBtnSecondary}
                    onClick={() =>
                      void resolveStaffAlias(String(a.id), st)
                        .then(() => {
                          toast.success(st)
                          return refresh()
                        })
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                    }
                  >
                    Mark {st}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

export function AdminOwnershipApprovalPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [items, setItems] = useState<Array<Record<string, unknown>>>([])
  const [total, setTotal] = useState(0)
  const [confidence, setConfidence] = useState('HIGH')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([])
  const [manualOwner, setManualOwner] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [result, directory] = await Promise.all([
        listOwnershipBackfillCandidates({
          status: 'PENDING',
          confidence: confidence || undefined,
          limit: 80,
        }),
        listStaffDirectory(true),
      ])
      setItems(result.items)
      setTotal(result.total)
      setStaff(directory)
      setSelected({})
      setPreview(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load candidates')
    } finally {
      setLoading(false)
    }
  }, [confidence])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function decide(
    id: string,
    decision: 'APPROVE' | 'REJECT' | 'DEFER' | 'MANUAL',
    applyNow = false,
  ) {
    try {
      await decideOwnershipCandidate({
        reviewId: id,
        decision,
        applyNow,
        manualOwnerId: decision === 'MANUAL' ? manualOwner[id] || null : null,
      })
      toast.success(applyNow ? 'Approved & applied' : decision)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Decision failed')
    }
  }

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([id]) => id)

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Preview / decide only until you explicitly apply a single row. Bulk apply is locked (
        <code>ownership_bulk_apply_authorized=false</code>). Apply writes <strong>current CRM owner</strong>{' '}
        only — never historical snapshots. HIGH confidence does not auto-apply.
      </p>
      <div className="flex flex-wrap gap-2">
        <BrandedSelect
          value={confidence}
          onValueChange={setConfidence}
          allowEmpty
          emptyLabel="Any confidence"
          options={[
            { value: 'EXPLICIT', label: 'A · EXPLICIT' },
            { value: 'HIGH', label: 'B · HIGH' },
            { value: 'MEDIUM', label: 'C · MEDIUM' },
            { value: 'LOW', label: 'C · LOW' },
            { value: 'CONFLICTING', label: 'D · CONFLICTING' },
            { value: 'NO_EVIDENCE', label: 'E · NO_EVIDENCE' },
          ]}
        />
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={!canReassignOwnership}
          onClick={() =>
            void enrichOwnershipCandidatesPhase5h()
              .then(() => refresh())
              .then(() => toast.success('Evidence enriched (no apply)'))
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Enrich failed'))
          }
        >
          Enrich evidence
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={!canReassignOwnership}
          onClick={() =>
            void rebuildOwnershipCandidates('company', 500)
              .then(() => enrichOwnershipCandidatesPhase5h())
              .then(() => refresh())
              .then(() => toast.success('Candidates rebuilt + enriched'))
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Rebuild failed'))
          }
        >
          Rebuild company candidates
        </button>
        <button
          type="button"
          className={adminBtnPrimary}
          disabled={!canReassignOwnership || selectedIds.length === 0}
          onClick={() =>
            void previewApplyOwnershipCandidates(selectedIds)
              .then((r) => {
                setPreview(r)
                toast.success(`Preview ${selectedIds.length} — not applied`)
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Preview failed'))
          }
        >
          Preview selected (no apply)
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={!canReassignOwnership}
          onClick={() =>
            void fetchOwnershipReviewPack(confidence === 'HIGH' ? 'B' : confidence === 'MEDIUM' ? 'C' : confidence === 'CONFLICTING' ? 'D' : undefined, 200)
              .then((pack) => {
                const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `ownership-review-pack-${Date.now()}.json`
                a.click()
                URL.revokeObjectURL(url)
                toast.success('Review pack downloaded')
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Export failed'))
          }
        >
          Export review pack
        </button>
        <span className="self-center text-xs text-[var(--admin-muted)]">{total.toLocaleString()} matching</span>
      </div>
      {preview && (
        <pre className="max-h-48 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const evidence = (r.evidence as Record<string, unknown>) ?? {}
            const orderDist = (evidence.order_distribution as Array<Record<string, unknown>>) ?? []
            const draftDist = (evidence.draft_distribution as Array<Record<string, unknown>>) ?? []
            return (
              <div key={String(r.id)} className="rounded-md border border-[var(--admin-border)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="mr-2 inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!selected[String(r.id)]}
                        onChange={(e) => setSelected((s) => ({ ...s, [String(r.id)]: e.target.checked }))}
                      />
                      <span className="font-medium">
                        {String(r.entity_type)} · {String(r.entity_name)}
                      </span>
                    </label>
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Batch {String(r.review_batch ?? '—')} · {String(r.resolution_class ?? '—')} ·{' '}
                      {String(r.confidence)} · priority {Number(r.material_priority ?? 0)}
                      {r.has_open_ar ? ' · OPEN AR' : ''}
                      {r.has_open_order ? ' · OPEN ORDER' : ''}
                      {r.has_open_draft ? ' · OPEN DRAFT' : ''}
                    </div>
                    <div className="mt-1 text-sm text-[var(--admin-text)]">
                      Current: {String(r.current_owner_name ?? '—')} → Proposed:{' '}
                      {String(r.proposed_owner_name ?? '—')}
                    </div>
                    <p className="mt-1 text-sm text-[var(--admin-muted)]">
                      {String(r.explanation ?? evidence.why ?? 'No explanation')}
                    </p>
                    {(orderDist.length > 0 || draftDist.length > 0) && (
                      <div className="mt-1 text-xs text-[var(--admin-muted)]">
                        Orders:{' '}
                        {orderDist.map((d) => `${d.name}×${d.count}`).join(', ') || '—'}
                        {' · '}
                        Drafts:{' '}
                        {draftDist.map((d) => `${d.name}×${d.count}`).join(', ') || '—'}
                      </div>
                    )}
                    {r.last_activity_at ? (
                      <div className="text-xs text-[var(--admin-muted)]">
                        Last activity: {String(r.last_activity_at)}
                      </div>
                    ) : null}
                  </div>
                  {canReassignOwnership && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={adminBtnSecondary} onClick={() => void decide(String(r.id), 'APPROVE', false)}>
                        Approve
                      </button>
                      <button type="button" className={adminBtnPrimary} onClick={() => void decide(String(r.id), 'APPROVE', true)}>
                        Approve & apply one
                      </button>
                      <button type="button" className={adminBtnSecondary} onClick={() => void decide(String(r.id), 'REJECT')}>
                        Reject
                      </button>
                      <button type="button" className={adminBtnSecondary} onClick={() => void decide(String(r.id), 'DEFER')}>
                        Defer
                      </button>
                      <div className="flex items-center gap-1">
                        <BrandedSelect
                          value={manualOwner[String(r.id)] ?? ''}
                          onValueChange={(v) => setManualOwner((m) => ({ ...m, [String(r.id)]: v }))}
                          allowEmpty
                          emptyLabel="Manual owner…"
                          options={staff.map((s) => ({ value: s.id, label: s.name }))}
                        />
                        <button
                          type="button"
                          className={adminBtnSecondary}
                          disabled={!manualOwner[String(r.id)]}
                          onClick={() => void decide(String(r.id), 'MANUAL', false)}
                        >
                          Manual select
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AdminPhase5hOwnershipReadinessPanel() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [readiness, staff, ownership, unowned, inactive] = await Promise.all([
        fetchCrmSalesCutoverReadiness(),
        fetchStaffDirectoryBaseline(),
        fetchOwnershipBaselineReport(),
        fetchUnownedAccountReport(40),
        fetchInactiveStaffOwnershipReport(),
      ])
      setData({ readiness, staff, ownership, unowned, inactive })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load ownership readiness')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />
  if (!data) return <p className="text-sm text-[var(--admin-muted)]">No readiness data.</p>

  const readiness = data.readiness as Record<string, unknown>
  const staff = data.staff as Record<string, unknown>
  const ownership = data.ownership as Record<string, unknown>

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--admin-text)]">CRM / Sales ownership readiness</h2>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Phase 5H evidence — no customer contact · no bulk auto-apply · ownership does not block commerce cutover alone.
          </p>
        </div>
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div className="rounded-md border border-[var(--admin-border)] p-3">
        <div className="text-sm font-medium">
          Status: {String(readiness.status)} · {String(readiness.reason)}
        </div>
        <div className="mt-2 grid gap-2 text-sm text-[var(--admin-muted)] sm:grid-cols-2 lg:grid-cols-4">
          <div>ACTIVE staff: {String(staff.ACTIVE_STAFF)}</div>
          <div>ADMIN linked: {String(staff.ADMIN_LINKED)}</div>
          <div>ALIAS unknown: {String(staff.ALIAS_UNKNOWN)}</div>
          <div>Pending candidates: {String(ownership.pending_candidates)}</div>
        </div>
      </div>
      <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

export function AdminLinkingPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [items, setItems] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await listCustomerCompanyLinkCandidates('PENDING', 80))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load link candidates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">Assisted linkage only — no auto-create companies.</p>
      <button
        type="button"
        className={adminBtnSecondary}
        disabled={!canReassignOwnership}
        onClick={() =>
          void rebuildCustomerCompanyLinkCandidates(300)
            .then(() => refresh())
            .then(() => toast.success('Link candidates rebuilt'))
            .catch((e) => toast.error(e instanceof Error ? e.message : 'Rebuild failed'))
        }
      >
        Rebuild candidates
      </button>
      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={String(r.id)} className="rounded-md border border-[var(--admin-border)] p-3">
              <div className="font-medium">
                {String(r.customer_name)} → {String(r.proposed_company_name ?? '—')}
              </div>
              <div className="text-xs text-[var(--admin-muted)]">{String(r.confidence)}</div>
              {canReassignOwnership && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={adminBtnPrimary}
                    disabled={!r.proposed_company_id}
                    onClick={() =>
                      void decideCustomerCompanyLink({
                        reviewId: String(r.id),
                        decision: 'LINK',
                        companyId: r.proposed_company_id ? String(r.proposed_company_id) : null,
                      })
                        .then(() => {
                          toast.success('Linked')
                          return refresh()
                        })
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                    }
                  >
                    Link to existing
                  </button>
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    onClick={() =>
                      void decideCustomerCompanyLink({ reviewId: String(r.id), decision: 'NO_COMPANY_REQUIRED' })
                        .then(() => refresh())
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                    }
                  >
                    No company required
                  </button>
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    onClick={() =>
                      void decideCustomerCompanyLink({ reviewId: String(r.id), decision: 'DEFER' })
                        .then(() => refresh())
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                    }
                  >
                    Defer
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AdminQualityHubPanel() {
  const [hub, setHub] = useState<Record<string, unknown> | null>(null)
  const [coverage, setCoverage] = useState<Record<string, unknown> | null>(null)
  const [cg, setCg] = useState<Record<string, unknown> | null>(null)
  const [dupes, setDupes] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void Promise.all([
      fetchCrmQualityHub(),
      fetchOwnershipCoverage(),
      fetchCgCurrentStatePolicy(),
      listCustomerDuplicateCandidates(undefined, 40),
    ])
      .then(([h, c, g, d]) => {
        setHub(h)
        setCoverage(c)
        setCg(g)
        setDupes(d)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load quality hub'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <AdminLoadingState />

  const cards = [
    ['Unowned customers', hub?.unowned_customers],
    ['Unowned companies', hub?.unowned_companies],
    ['Unknown aliases', hub?.unknown_staff_aliases],
    ['Ownership pending', hub?.ownership_candidates_pending],
    ['HIGH/EXPLICIT pending', hub?.ownership_candidates_high],
    ['Link candidates', hub?.link_candidates_pending],
    ['Company dupes', hub?.duplicate_company_groups],
    ['Customer dupes', hub?.duplicate_customer_groups],
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="rounded-md border border-[var(--admin-border)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{Number(value ?? 0).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-[var(--admin-border)] p-3 text-sm">
        <div className="font-medium">CG current-state policy</div>
        <p className="mt-1 text-[var(--admin-muted)]">
          {String(cg?.recommendation ?? '—')}: {String(cg?.evidence ?? '')}
        </p>
      </div>
      <div className="rounded-md border border-[var(--admin-border)] p-3 text-sm">
        <div className="font-medium">Ownership coverage</div>
        <pre className="mt-2 max-h-48 overflow-auto text-xs text-[var(--admin-muted)]">
          {JSON.stringify(coverage?.customers ?? {}, null, 2)}
          {'\n'}
          {JSON.stringify(coverage?.companies ?? {}, null, 2)}
        </pre>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Customer duplicate candidates (exact email)</h3>
          <button
            type="button"
            className={adminBtnSecondary}
            onClick={() =>
              void rebuildCustomerDuplicateCandidates()
                .then(() => listCustomerDuplicateCandidates(undefined, 40))
                .then(setDupes)
                .then(() => toast.success('Rebuilt'))
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
            }
          >
            Rebuild
          </button>
        </div>
        <div className="space-y-2">
          {dupes.map((d) => (
            <div key={String(d.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--admin-border)] p-2 text-sm">
              <span>
                {String(d.group_key)} · {Array.isArray(d.customer_ids) ? d.customer_ids.length : 0} · {String(d.status)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={adminBtnSecondary}
                  onClick={() =>
                    void reviewCustomerDuplicate(String(d.id), 'NOT_DUPLICATE').then(() =>
                      listCustomerDuplicateCandidates(undefined, 40).then(setDupes),
                    )
                  }
                >
                  Not duplicate
                </button>
                <button
                  type="button"
                  className={adminBtnSecondary}
                  onClick={() =>
                    void reviewCustomerDuplicate(String(d.id), 'REVIEWED').then(() =>
                      listCustomerDuplicateCandidates(undefined, 40).then(setDupes),
                    )
                  }
                >
                  Reviewed
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">
        SureCust = {String(hub?.surecust_model)} · no hidden cleanup · no auto backfill · no merge
      </p>
    </div>
  )
}
