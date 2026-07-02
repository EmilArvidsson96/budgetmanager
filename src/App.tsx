import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { PlanView }             from './views/Plan'
import { ReportView }           from './views/Report'
import { ReconcileView }        from './views/Reconcile'
import { LiquidityView }        from './views/Liquidity'
import { ImportView }           from './views/Import'
import { SettingsView }         from './views/Settings'
import { HelpView }             from './views/Help'
import { GroceryReceiptsView }  from './views/GroceryReceipts'
import { FlowView }             from './views/Transactions'
import { TransactionListView }  from './views/TransactionList'
import { PinGate }              from './components/PinGate'
import { useGitHubSync }        from './hooks/useGitHubSync'
import { useSnapshots }         from './hooks/useSnapshots'

function AppRoutes() {
  useGitHubSync()
  useSnapshots()
  return (
    <Routes>
      <Route path="/"               element={<Navigate to="/plan" replace />} />
      <Route path="/plan"           element={<PlanView />} />
      <Route path="/manad"          element={<Navigate to="/plan" replace />} />
      <Route path="/ar"             element={<Navigate to="/plan" replace />} />
      <Route path="/likviditet"     element={<Navigate to="/plan" replace />} />
      <Route path="/likviditet-gammal" element={<LiquidityView />} />
      <Route path="/floede"         element={<FlowView />} />
      <Route path="/rapport"        element={<ReportView />} />
      <Route path="/avstamning"     element={<ReconcileView />} />
      <Route path="/transaktioner"  element={<TransactionListView />} />
      <Route path="/importera"      element={<ImportView />} />
      <Route path="/kvitton"        element={<GroceryReceiptsView />} />
      <Route path="/installningar"  element={<SettingsView />} />
      <Route path="/hjalp"          element={<HelpView />} />
    </Routes>
  )
}

export default function App() {
  return (
    <PinGate>
      <BrowserRouter basename="/budgetmanager">
        <AppRoutes />
      </BrowserRouter>
    </PinGate>
  )
}
