export interface BudgetLine {
  id?: string;
  category: string;
  amount: number;
  notes?: string;
}

export interface Budget {
  id: string;
  year: number;
  totalIncome?: number;
  totalExpense?: number;
  lines?: BudgetLine[];
  approved?: boolean;
  approvedById?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface Budget {
}
