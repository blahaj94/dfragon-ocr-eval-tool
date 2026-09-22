import React from 'react'
import ReactDOM from 'react-dom/client'
import { EvaluationPage } from './pages/EvaluationPage'
import './styles.css'

const root = document.getElementById('root')
if (root == null) {
  throw new Error('앱을 표시할 루트가 없습니다.')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <EvaluationPage />
  </React.StrictMode>
)
