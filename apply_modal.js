const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'index.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');
if (!cssContent.includes('.crz-logout-overlay')) {
  fs.appendFileSync(cssPath, `
/* Logout Modal */
.crz-logout-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.crz-logout-modal {
  background: white;
  padding: 24px;
  border-radius: 12px;
  width: 90%;
  max-width: 320px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.1);
  text-align: center;
}

.crz-logout-modal h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
  color: #333;
}

.crz-logout-modal p {
  margin: 0 0 20px 0;
  font-size: 14px;
  color: #666;
}

.crz-logout-actions {
  display: flex;
  gap: 12px;
}

.crz-logout-cancel,
.crz-logout-confirm {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.crz-logout-cancel {
  background: #f0f0f0;
  color: #555;
}

.crz-logout-confirm {
  background: #ea2a2a;
  color: white;
}
`);
}

const modalJsx = `
      {showLogoutConfirm && (
        <div className="crz-logout-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="crz-logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Logout</h3>
            <p>Are you sure you want to logout?</p>
            <div className="crz-logout-actions">
              <button className="crz-logout-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="crz-logout-confirm" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        </div>
      )}
`;

const files = [
  'src/pages/crunzzo/CrunzzoDistributorDashboard.jsx',
  'src/pages/crunzzo/CrunzzoAdminDashboard.jsx',
  'src/pages/bounce/BounceDistributorDashboard.jsx',
  'src/pages/bounce/BounceAdminDashboard.jsx',
  'src/pages/valencia/ValenciaDistributorDashboard.jsx',
  'src/pages/valencia/ValenciaAdminDashboard.jsx',
];

files.forEach((file) => {
  const fullPath = path.join(__dirname, file);
  let content = fs.readFileSync(fullPath, 'utf8');

  // 1. Add state if not present
  if (!content.includes('showLogoutConfirm')) {
    if (content.includes('const [screen, setScreen] = useState("home");')) {
      content = content.replace(
        'const [screen, setScreen] = useState("home");',
        'const [screen, setScreen] = useState("home");\\n  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);'
      );
    } else if (content.includes('const [activeTab, setActiveTab] = useState("dashboard");')) {
      content = content.replace(
        'const [activeTab, setActiveTab] = useState("dashboard");',
        'const [activeTab, setActiveTab] = useState("dashboard");\\n  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);'
      );
    }

    // 2. Fix popstate handler
    const popstateRegex = /if \\(window\\.confirm\\("Are you sure you want to logout\\?"\\)\\) \\{\\s+signOut\\(auth\\)\\.then\\(\\(\\) => \\{\\s+navigate\\("\\/choose-section"\\);\\s+\\}\\)\\.catch\\(\\(err\\) => console\\.error\\("Logout error:", err\\)\\);\\s+return;\\s+\\}/g;
    content = content.replace(popstateRegex, 'setShowLogoutConfirm(true);');

    // 3. Fix handleLogout logic that has window.confirm baked in
    content = content.replace(
      'if (!window.confirm("Are you sure you want to logout?")) return;',
      ''
    );

    // 4. Fix any inline window.confirm on clicks (e.g. BounceAdminDashboard)
    content = content.replace(
      /if \\(window\\.confirm\\("Are you sure you want to logout\\?"\\)\\) \\{\\s+handleLogout\\(\\);\\s+\\}/g,
      'setShowLogoutConfirm(true);'
    );

    // 5. Replace standard onClick={handleLogout} with onClick={() => setShowLogoutConfirm(true)}
    content = content.replace(
      /onClick=\\{handleLogout\\}/g,
      'onClick={() => setShowLogoutConfirm(true)}'
    );

    // 6. Append modal JSX before the last </div>
    // Find the last occurrence of '    </div>\r\n  );\r\n}' or similar
    const closingPattern = /\\s*<\\/div>\\s*<\\/div>\\s*\\);\\s*\\}\\s*$/;
    if (closingPattern.test(content)) {
      content = content.replace(closingPattern, (match) => {
        return modalJsx + match;
      });
    } else {
        // Fallback for different line endings or slight structure differences
        const closingPattern2 = /\\s*<\\/div>\\n\\s*<\\/div>\\n\\s*\\);\\n\\}/;
        content = content.replace(closingPattern2, (match) => {
            return modalJsx + match;
        });
    }
    
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Processed:', file);
  }
});
