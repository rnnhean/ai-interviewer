import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { DigitalHuman } from './components/DigitalHuman';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');

/** ?avatar-preview 是一个只渲染数字人的调试页，用来对比候选模型 */
const isAvatarPreview = new URLSearchParams(globalThis.location.search).has('avatar-preview');

createRoot(root).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 10 } }}>
      <AntApp>
        {isAvatarPreview ? (
          <div style={{ width: '100vw', height: '100vh' }}>
            <DigitalHuman speaking={false} />
          </div>
        ) : (
          <BrowserRouter>
            <App />
          </BrowserRouter>
        )}
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
