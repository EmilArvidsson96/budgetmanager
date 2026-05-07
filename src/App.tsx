import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MonthlyBudgetView }    from './views/MonthlyBudget'
import { YearlyBudgetView }     from './views/YearlyBudget'
import { LiquidityView }        from './views/Liquidity'
import { ImportView }           from './views/Import'
import { SettingsView }         from './views/Settings'
import { HelpView }             from './views/Help'
import { GroceryReceiptsView }  from './views/GroceryReceipts'
import { PinGate }              from './components/PinGate'

export default function App() {
  return (
    <PinGate>
    <BrowserRouter basename="/budgetmanager">
      <Routes>
        <Route path="/"               element={<Navigate to="/manad" replace />} />
        <Route path="/manad"          element={<MonthlyBudgetView />} />
        <Route path="/ar"             element={<YearlyBudgetView />} />
        <Route path="/likviditet"     element={<LiquidityView />} />
        <Route path="/importera"      element={<ImportView />} />
        <Route path="/kvitton"        element={<GroceryReceiptsView />} />
        <Route path="/installningar"  element={<SettingsView />} />
        <Route path="/hjalp"          element={<HelpView />} />
      </Routes>
    </BrowserRouter>
    </PinGate>
  )
}
