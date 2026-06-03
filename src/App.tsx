import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthGuard } from "@/components/AuthGuard";
import Login from "./pages/Login";
import Expenses from "./pages/Expenses";
import Insights from "./pages/Insights";
import MerchantMemory from "./pages/MerchantMemory";
import SettingsPage from "./pages/Settings";
import Income from "./pages/Income";

import Wealth from "./pages/Wealth";
import Tax from "./pages/Tax";
import Accountant from "./pages/Accountant";
import Allocations from "./pages/Allocations";
import CloseMonth from "./pages/CloseMonth";
import NotFound from "./pages/NotFound";
import Assistant from "./pages/Assistant";
import Subscriptions from "./pages/Subscriptions";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<AuthGuard><Expenses /></AuthGuard>} />
          <Route path="/insights" element={<AuthGuard><Insights /></AuthGuard>} />
          <Route path="/subscriptions" element={<AuthGuard><Subscriptions /></AuthGuard>} />
          <Route path="/merchants" element={<AuthGuard><MerchantMemory /></AuthGuard>} />
          <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
          <Route path="/income" element={<AuthGuard><Income /></AuthGuard>} />
          
          <Route path="/wealth" element={<AuthGuard><Wealth /></AuthGuard>} />
          <Route path="/tax" element={<AuthGuard><Tax /></AuthGuard>} />
          <Route path="/accountant" element={<AuthGuard><Accountant /></AuthGuard>} />
          <Route path="/allocations" element={<AuthGuard><Allocations /></AuthGuard>} />
          <Route path="/close-month" element={<AuthGuard><CloseMonth /></AuthGuard>} />
          <Route path="/assistant" element={<AuthGuard><Assistant /></AuthGuard>} />
          <Route path="/assistant/:threadId" element={<AuthGuard><Assistant /></AuthGuard>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
