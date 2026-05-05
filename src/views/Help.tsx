import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card } from '@/components/ui/Card'

export function HelpView() {
  return (
    <Layout>
      <PageHeader
        title="Hjälp & manual"
        subtitle="Lär dig använda Budgethanteraren steg för steg"
      />

      <div className="space-y-8">
        <OverviewSection />
        <MonthlyBudgetSection />
        <YearlyBudgetSection />
        <LiquiditySection />
        <ImportSection />
        <SettingsSection />
      </div>
    </Layout>
  )
}

// ─── Workflow overview ────────────────────────────────────────────────────────

function OverviewSection() {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Översikt – så fungerar verktyget</h2>
      <p className="text-sm text-gray-500 mb-6">
        Budgethanteraren hjälper dig planera din ekonomi månads- och årsvis och jämföra planerat mot verkligt utfall.
      </p>

      {/* Workflow diagram */}
      <svg viewBox="0 0 720 160" className="w-full" aria-label="Arbetsflödesöversikt">
        {/* Step boxes */}
        {[
          { x: 20,  label: '1. Inställningar', sub: 'Konton & återkommande poster', color: '#6366f1' },
          { x: 200, label: '2. Månadsbudget',  sub: 'Planera varje månads poster',  color: '#0ea5e9' },
          { x: 380, label: '3. Importera',     sub: 'Hämta utfall från Zlantar',    color: '#10b981' },
          { x: 560, label: '4. Analysera',     sub: 'Jämför budget vs utfall',      color: '#f59e0b' },
        ].map(({ x, label, sub, color }) => (
          <g key={x}>
            <rect x={x} y={20} width={140} height={70} rx={10} fill={color} fillOpacity={0.1} stroke={color} strokeWidth={1.5} />
            <text x={x + 70} y={52} textAnchor="middle" fontSize={12} fontWeight="600" fill={color}>{label}</text>
            <foreignObject x={x + 8} y={58} width={124} height={36}>
              <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center', lineHeight: '14px' }}>{sub}</div>
            </foreignObject>
          </g>
        ))}

        {/* Arrows */}
        {[160, 340, 520].map((x) => (
          <g key={x}>
            <line x1={x} y1={55} x2={x + 32} y2={55} stroke="#d1d5db" strokeWidth={2} />
            <polygon points={`${x + 32},50 ${x + 40},55 ${x + 32},60`} fill="#d1d5db" />
          </g>
        ))}

        {/* Bottom note */}
        <text x={360} y={130} textAnchor="middle" fontSize={11} fill="#9ca3af">
          Årsbudget och likviditet ger en bredare bild av hela året
        </text>
        <line x1={110} y1={118} x2={630} y2={118} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="4 3" />
      </svg>
    </Card>
  )
}

// ─── Monthly budget ───────────────────────────────────────────────────────────

function MonthlyBudgetSection() {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs flex items-center justify-center font-bold">1</span>
        Månadsbudget
      </h2>
      <Card>
        <p className="text-sm text-gray-600 mb-5">
          Månadsbudgeten är din huvudvy. Här planerar du inkomster, utgifter och sparande för en given månad,
          och ser hur du ligger till mot verkligt utfall efter en Zlantar-import.
        </p>

        {/* Figure: monthly budget table mockup */}
        <svg viewBox="0 0 680 260" className="w-full rounded-lg" aria-label="Månadsbudget figur">
          <rect width={680} height={260} rx={10} fill="#f9fafb" />

          {/* Month navigator */}
          <rect x={20} y={16} width={640} height={36} rx={8} fill="white" stroke="#e5e7eb" />
          <text x={40} y={39} fontSize={11} fill="#9ca3af">‹</text>
          <text x={280} y={39} textAnchor="middle" fontSize={13} fontWeight="600" fill="#111827">April 2025</text>
          <text x={640} y={39} textAnchor="end" fontSize={11} fill="#9ca3af">›</text>

          {/* Summary cards */}
          {[
            { x: 20,  label: 'Inkomster',    val: '45 000 kr', color: '#059669', border: '#34d399' },
            { x: 178, label: 'Utgifter',     val: '28 500 kr', color: '#dc2626', border: '#f87171' },
            { x: 336, label: 'Sparande',     val: '10 000 kr', color: '#2563eb', border: '#60a5fa' },
            { x: 494, label: 'Nettoresultat',val: '+ 6 500 kr', color: '#059669', border: '#34d399' },
          ].map(({ x, label, val, color, border }) => (
            <g key={x}>
              <rect x={x} y={64} width={148} height={56} rx={8} fill="white" stroke="#e5e7eb" strokeWidth={1} />
              <rect x={x} y={64} width={148} height={3} rx={1} fill={border} />
              <text x={x + 10} y={84} fontSize={9} fill="#9ca3af" fontWeight="500">{label.toUpperCase()}</text>
              <text x={x + 10} y={106} fontSize={14} fontWeight="700" fill={color}>{val}</text>
            </g>
          ))}

          {/* Table header */}
          <rect x={20} y={134} width={640} height={24} rx={0} fill="#f3f4f6" />
          <text x={30} y={150} fontSize={9} fontWeight="600" fill="#9ca3af">KATEGORI</text>
          <text x={440} y={150} fontSize={9} fontWeight="600" fill="#9ca3af" textAnchor="end">BUDGET</text>
          <text x={530} y={150} fontSize={9} fontWeight="600" fill="#9ca3af" textAnchor="end">UTFALL</text>
          <text x={610} y={150} fontSize={9} fontWeight="600" fill="#9ca3af" textAnchor="end">FÖRBRUKAT</text>

          {/* Category rows */}
          {[
            { y: 158, name: 'Lön',        badge: 'Inkomst', badgeC: '#059669', badgeBg: '#d1fae5', amt: '45 000',  act: '45 000',  pct: 100 },
            { y: 182, name: 'Boende',     badge: 'Utgift',  badgeC: '#6b7280', badgeBg: '#f3f4f6', amt: '12 000',  act: '11 840',  pct: 99  },
            { y: 206, name: 'Mat & dryck',badge: 'Utgift',  badgeC: '#6b7280', badgeBg: '#f3f4f6', amt: '5 000',   act: '6 120',   pct: 100 },
            { y: 230, name: 'Sparande',   badge: 'Spar',    badgeC: '#2563eb', badgeBg: '#dbeafe', amt: '10 000',  act: '10 000',  pct: 100 },
          ].map(({ y, name, badge, badgeC, badgeBg, amt, act, pct }) => (
            <g key={y}>
              <rect x={20} y={y} width={640} height={24} fill="white" />
              <line x1={20} y1={y} x2={660} y2={y} stroke="#f3f4f6" />
              <text x={42} y={y + 15} fontSize={11} fontWeight="500" fill="#111827">{name}</text>
              <rect x={100} y={y + 4} width={36} height={14} rx={7} fill={badgeBg} />
              <text x={118} y={y + 15} fontSize={8} fontWeight="600" fill={badgeC} textAnchor="middle">{badge}</text>
              <text x={440} y={y + 15} fontSize={11} fill="#374151" textAnchor="end">{amt}</text>
              <text x={530} y={y + 15} fontSize={11} fill="#374151" textAnchor="end">{act}</text>
              {/* Progress bar */}
              <rect x={548} y={y + 8} width={100} height={6} rx={3} fill="#f3f4f6" />
              <rect x={548} y={y + 8} width={Math.min(pct, 100)} height={6} rx={3}
                fill={pct > 100 ? '#ef4444' : pct > 80 ? '#f59e0b' : '#10b981'} />
            </g>
          ))}
        </svg>

        <div className="mt-5 grid md:grid-cols-3 gap-4 text-sm">
          <Step n="1" title="Navigera månader">
            Använd pilarna ‹ › längst upp för att byta månad. Klicka <strong>Skapa månadsbudget</strong> om ingen budget finns för vald månad.
          </Step>
          <Step n="2" title="Fyll i belopp">
            Klicka direkt i ett beloppsfield och skriv in summan. Kategorier med underkategorier kan expanderas med pilen till vänster.
          </Step>
          <Step n="3" title="Exportera">
            Knappen <strong>Exportera</strong> skapar en Excel-fil med månads- och årsvy som är AI-navigerbar.
          </Step>
        </div>
      </Card>
    </section>
  )
}

// ─── Yearly budget ────────────────────────────────────────────────────────────

function YearlyBudgetSection() {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-bold">2</span>
        Årsbudget
      </h2>
      <Card>
        <p className="text-sm text-gray-600 mb-5">
          Årsbudgeten summerar alla månadsbudgetar i ett rutnät. Varje rad är en kategori,
          varje kolumn en månad – perfekt för att se mönster och planera helårsekonomi.
        </p>

        {/* Figure: yearly grid */}
        <svg viewBox="0 0 680 180" className="w-full rounded-lg" aria-label="Årsbudget figur">
          <rect width={680} height={180} rx={10} fill="#f9fafb" />

          {/* Header row */}
          <rect x={0} y={0} width={680} height={28} rx={0} fill="#f3f4f6" />
          <rect x={0} y={0} width={680} height={10} rx={5} fill="#f3f4f6" />
          <text x={100} y={18} fontSize={9} fontWeight="600" fill="#9ca3af" textAnchor="middle">KATEGORI</text>
          {['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'].map((m, i) => (
            <text key={m} x={210 + i * 40} y={18} fontSize={8} fontWeight="600" fill="#9ca3af" textAnchor="middle">{m}</text>
          ))}
          <text x={698} y={18} fontSize={8} fontWeight="600" fill="#9ca3af" textAnchor="middle" />

          {/* Data rows */}
          {[
            { name: 'Lön',        color: '#059669', vals: [45,45,45,45,45,45,45,45,45,45,45,70] },
            { name: 'Boende',     color: '#6b7280', vals: [12,12,12,12,12,12,12,12,12,12,12,12] },
            { name: 'Mat & dryck',color: '#6b7280', vals: [5,4.8,5.2,6.1,5,5,4.9,5.3,5.1,5,5.2,6] },
            { name: 'Sparande',   color: '#2563eb', vals: [10,10,10,10,10,10,10,10,10,10,10,10] },
          ].map(({ name, color, vals }, ri) => {
            const y = 28 + ri * 36
            const max = Math.max(...vals)
            return (
              <g key={name}>
                <rect x={0} y={y} width={680} height={36} fill={ri % 2 === 0 ? 'white' : '#fafafa'} />
                <circle cx={16} cy={y + 18} r={5} fill={color} fillOpacity={0.3} />
                <circle cx={16} cy={y + 18} r={3} fill={color} />
                <text x={28} y={y + 22} fontSize={11} fontWeight="500" fill="#374151">{name}</text>
                {vals.map((v, i) => {
                  const h = Math.round((v / max) * 22)
                  const barY = y + 32 - h
                  const isHigh = v === max
                  return (
                    <g key={i}>
                      <rect x={205 + i * 40} y={barY} width={28} height={h} rx={3}
                        fill={isHigh ? '#f59e0b' : color} fillOpacity={isHigh ? 0.8 : 0.25} />
                      <text x={219 + i * 40} y={y + 29} fontSize={7} fill="#9ca3af" textAnchor="middle">
                        {v}k
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* Highlight annotation */}
          <rect x={196} y={64} width={44} height={72} rx={4} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 2" />
          <text x={218} y={150} textAnchor="middle" fontSize={9} fill="#f59e0b">Dec avviker</text>
        </svg>

        <div className="mt-4 text-sm text-gray-500">
          Celler med avvikande värden markeras automatiskt. Klicka på en cells belopp för att hoppa till den aktuella månadsbudgeten.
        </div>
      </Card>
    </section>
  )
}

// ─── Liquidity ────────────────────────────────────────────────────────────────

function LiquiditySection() {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-xs flex items-center justify-center font-bold">3</span>
        Likviditet
      </h2>
      <Card>
        <p className="text-sm text-gray-600 mb-5">
          Likviditetsvyn visar hur ditt totala kassaflöde rör sig under året. Du lägger in
          enstaka händelser (löneutbetalning, semesterräkning, skatteåterbäring) och ser saldot
          som ett diagram per månad.
        </p>

        {/* Figure: area chart mockup */}
        <svg viewBox="0 0 680 180" className="w-full rounded-lg" aria-label="Likviditetsgraf figur">
          <rect width={680} height={180} rx={10} fill="#f9fafb" />

          {/* Y-axis labels */}
          {[0, 50, 100, 150, 200].map((v, i) => (
            <g key={v}>
              <line x1={55} y1={148 - i * 28} x2={660} y2={148 - i * 28} stroke="#e5e7eb" strokeWidth={1} />
              <text x={50} y={152 - i * 28} fontSize={9} fill="#9ca3af" textAnchor="end">{v}k</text>
            </g>
          ))}

          {/* Area path (simplified sine-ish wave going up) */}
          {(() => {
            const months = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec']
            const vals = [110,95,120,130,115,140,128,155,145,160,152,180]
            const xs = months.map((_, i) => 60 + i * 50)
            const ys = vals.map((v) => 148 - ((v - 80) / 120) * 112)
            const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ')
            const area = `M ${xs[0]},148 ` + xs.map((x, i) => `L ${x},${ys[i]}`).join(' ') + ` L ${xs[xs.length - 1]},148 Z`
            return (
              <>
                <path d={area} fill="url(#liqGrad)" />
                <polyline points={pts} fill="none" stroke="#0ea5e9" strokeWidth={2} />
                {xs.map((x, i) => (
                  <g key={i}>
                    <circle cx={x} cy={ys[i]} r={3} fill="#0ea5e9" />
                    <text x={x} y={168} fontSize={8} fill="#9ca3af" textAnchor="middle">{months[i]}</text>
                  </g>
                ))}
                <defs>
                  <linearGradient id="liqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </>
            )
          })()}

          {/* Event marker */}
          <line x1={360} y1={20} x2={360} y2={105} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 2" />
          <rect x={290} y={10} width={140} height={22} rx={5} fill="#fef3c7" stroke="#fcd34d" />
          <text x={360} y={25} textAnchor="middle" fontSize={9} fill="#92400e">+ Skatteåterbäring 18k</text>
        </svg>

        <div className="mt-5 grid md:grid-cols-2 gap-4 text-sm">
          <Step n="1" title="Skapa likviditetsplan">
            Navigera till rätt år och klicka <strong>Skapa likviditetsplan</strong>. Ange ingående saldon för dina konton.
          </Step>
          <Step n="2" title="Lägg till händelser">
            Klicka <strong>Lägg till</strong> för att registrera en inkomst, utgift eller överföring med datum och belopp.
            Markera som <em>Bekräftad</em> om den redan är bokförd.
          </Step>
        </div>
      </Card>
    </section>
  )
}

// ─── Import ───────────────────────────────────────────────────────────────────

function ImportSection() {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs flex items-center justify-center font-bold">4</span>
        Importera från Zlantar
      </h2>
      <Card>
        <p className="text-sm text-gray-600 mb-5">
          Import-flödet läser in dina transaktioner från Zlantar-appen och mappar dem mot dina kategorier
          så att verkligt utfall syns bredvid din budget.
        </p>

        {/* Figure: import flow */}
        <svg viewBox="0 0 680 160" className="w-full rounded-lg" aria-label="Importflöde figur">
          <rect width={680} height={160} rx={10} fill="#f9fafb" />

          {/* Zlantar box */}
          <rect x={20} y={40} width={140} height={80} rx={10} fill="#ecfdf5" stroke="#6ee7b7" strokeWidth={1.5} />
          <text x={90} y={72} textAnchor="middle" fontSize={12} fontWeight="600" fill="#065f46">Zlantar-app</text>
          <text x={90} y={89} textAnchor="middle" fontSize={9} fill="#34d399">Profil → Inst.</text>
          <text x={90} y={103} textAnchor="middle" fontSize={9} fill="#34d399">→ Exportera data</text>

          {/* ZIP */}
          <rect x={194} y={55} width={90} height={50} rx={8} fill="#fff7ed" stroke="#fed7aa" strokeWidth={1.5} />
          <text x={239} y={78} textAnchor="middle" fontSize={10} fontWeight="600" fill="#9a3412">📦 ZIP</text>
          <text x={239} y={94} textAnchor="middle" fontSize={8} fill="#c2410c">transactions.json</text>
          <text x={239} y={106} textAnchor="middle" fontSize={8} fill="#c2410c">data.json</text>

          {/* Upload box */}
          <rect x={318} y={40} width={160} height={80} rx={10} fill="#eff6ff" stroke="#93c5fd" strokeWidth={1.5} />
          <text x={398} y={70} textAnchor="middle" fontSize={11} fontWeight="600" fill="#1d4ed8">Importera-sidan</text>
          <text x={398} y={86} textAnchor="middle" fontSize={9} fill="#60a5fa">Dra & släpp filerna</text>
          <text x={398} y={101} textAnchor="middle" fontSize={9} fill="#60a5fa">eller klicka för att välja</text>

          {/* Result box */}
          <rect x={512} y={40} width={148} height={80} rx={10} fill="#faf5ff" stroke="#c4b5fd" strokeWidth={1.5} />
          <text x={586} y={70} textAnchor="middle" fontSize={11} fontWeight="600" fill="#6d28d9">Utfall importerat</text>
          <text x={586} y={86} textAnchor="middle" fontSize={9} fill="#a78bfa">Syns i månadsbudget</text>
          <text x={586} y={101} textAnchor="middle" fontSize={9} fill="#a78bfa">under "Utfall"-kolumnen</text>

          {/* Arrows */}
          {[[160,80],[284,80],[478,80]].map(([x,y], i) => (
            <g key={i}>
              <line x1={x} y1={y} x2={x+26} y2={y} stroke="#d1d5db" strokeWidth={1.5} />
              <polygon points={`${x+26},${y-4} ${x+34},${y} ${x+26},${y+4}`} fill="#d1d5db" />
            </g>
          ))}

          {/* Step labels */}
          <text x={90}  y={140} textAnchor="middle" fontSize={9} fill="#9ca3af">Steg 1: exportera</text>
          <text x={239} y={140} textAnchor="middle" fontSize={9} fill="#9ca3af">Steg 2: packa upp</text>
          <text x={398} y={140} textAnchor="middle" fontSize={9} fill="#9ca3af">Steg 3: ladda upp</text>
          <text x={586} y={140} textAnchor="middle" fontSize={9} fill="#9ca3af">Steg 4: klart!</text>
        </svg>

        <div className="mt-5 grid md:grid-cols-3 gap-4 text-sm">
          <Step n="1" title="Exportera från Zlantar">
            Öppna Zlantar → Profil → Inställningar → <strong>Exportera min data</strong>. Du får en ZIP-fil via e-post eller delning.
          </Step>
          <Step n="2" title="Välj filer">
            Packa upp ZIP-filen. Dra <strong>transactions.json</strong> (obligatorisk) och <strong>data.json</strong> (valfri) till respektive
            dropzon på importera-sidan.
          </Step>
          <Step n="3" title="Granska & bekräfta">
            Granska förhandsvisningen – okända kategorier visas med varning. Klicka <strong>Bekräfta import</strong> för att spara utfallet.
          </Step>
        </div>
      </Card>
    </section>
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsSection() {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs flex items-center justify-center font-bold">5</span>
        Inställningar
      </h2>
      <Card>
        <p className="text-sm text-gray-600 mb-5">
          Under Inställningar hanterar du konton, återkommande poster och kategorier.
        </p>

        {/* Figure: settings tabs */}
        <svg viewBox="0 0 680 190" className="w-full rounded-lg" aria-label="Inställningar figur">
          <rect width={680} height={190} rx={10} fill="#f9fafb" />

          {/* Tab bar */}
          <rect x={20} y={16} width={640} height={32} rx={6} fill="white" stroke="#e5e7eb" />
          {[
            { x: 30,  w: 100, label: 'Konton',       active: true  },
            { x: 140, w: 160, label: 'Återkommande', active: false },
            { x: 310, w: 120, label: 'Kategorier',   active: false },
          ].map(({ x, w, label, active }) => (
            <g key={label}>
              {active && <rect x={x - 2} y={40} width={w + 4} height={2} rx={1} fill="#4f46e5" />}
              <text x={x + w / 2} y={36} textAnchor="middle" fontSize={11}
                fontWeight={active ? '600' : '400'} fill={active ? '#4f46e5' : '#6b7280'}>{label}</text>
            </g>
          ))}

          {/* Konton list */}
          {[
            { name: 'Swedbank Lönekonto', bank: 'Swedbank', badge: 'Lönekonto',  bc: '#6b7280', bbg: '#f3f4f6' },
            { name: 'SEB Sparkonto',      bank: 'SEB',      badge: 'Sparkonto',  bc: '#2563eb', bbg: '#dbeafe' },
            { name: 'Bolån Handelsbanken',bank: 'HB',       badge: 'Lån 2.4%',  bc: '#dc2626', bbg: '#fee2e2' },
          ].map(({ name, bank, badge, bc, bbg }, i) => (
            <g key={name}>
              <rect x={20} y={60 + i * 40} width={640} height={38} rx={6} fill="white" stroke="#f3f4f6" />
              <circle cx={42} cy={79 + i * 40} r={8} fill="#f3f4f6" />
              <text x={58} y={75 + i * 40} fontSize={11} fontWeight="500" fill="#111827">{name}</text>
              <text x={58} y={90 + i * 40} fontSize={9} fill="#9ca3af">{bank}</text>
              <rect x={560} y={67 + i * 40} width={60} height={18} rx={9} fill={bbg} />
              <text x={590} y={80 + i * 40} textAnchor="middle" fontSize={9} fontWeight="600" fill={bc}>{badge}</text>
              {/* Edit / delete icons */}
              <text x={634} y={82 + i * 40} fontSize={12} fill="#9ca3af">✎</text>
            </g>
          ))}

          {/* Add button */}
          <rect x={20} y={184} width={86} height={0} />
          <rect x={572} y={170} width={88} height={16} rx={8} fill="#4f46e5" />
          <text x={616} y={181} textAnchor="middle" fontSize={9} fontWeight="600" fill="white">+ Lägg till</text>
        </svg>

        <div className="mt-5 grid md:grid-cols-3 gap-4 text-sm">
          <Step n="1" title="Konton">
            Lägg till dina bankkonton, sparkonton och lån. Aktivera <strong>Inkludera i likviditet</strong> för de konton
            vars saldo ska räknas in i likviditetsvyn.
          </Step>
          <Step n="2" title="Återkommande poster">
            Spara fasta utgifter (hyra, abonnemang) och inkomster (lön). Dessa <strong>förifylls automatiskt</strong> när du
            skapar en ny månadsbudget.
          </Step>
          <Step n="3" title="Kategorier">
            Kategorier importeras från Zlantar och visas här för referens. De matchar automatiskt mot transaktionerna vid import.
          </Step>
        </div>
      </Card>
    </section>
  )
}

// ─── Helper component ─────────────────────────────────────────────────────────

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <div className="font-medium text-gray-800 mb-0.5">{title}</div>
        <div className="text-gray-500 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
