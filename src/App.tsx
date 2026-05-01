import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MonthlyBudgetView } from './views/MonthlyBudget'
import { YearlyBudgetView }  from './views/YearlyBudget'
import { LiquidityView }     from './views/Liquidity'
import { ImportView }        from './views/Import'
import { SettingsView }      from './views/Settings'

export default function App() {
  return (
    <BrowserRouter basename="/budgetmanager">
      <Routes>
        <Route path="/"               element={<Navigate to="/manad" replace />} />
        <Route path="/manad"          element={<MonthlyBudgetView />} />
        <Route path="/ar"             element={<YearlyBudgetView />} />
        <Route path="/likviditet"     element={<LiquidityView />} />
        <Route path="/importera"      element={<ImportView />} />
        <Route path="/installningar"  element={<SettingsView />} />
      </Routes>
    </BrowserRouter>
  )
}
