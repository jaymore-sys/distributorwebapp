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

    const popstateSearch = \`        if (window.confirm("Are you sure you want to logout?")) {
          signOut(auth).then(() => {
            navigate("/choose-section");
          }).catch((err) => console.error("Logout error:", err));
          return;
        }\`;
    content = content.replace(popstateSearch, '        setShowLogoutConfirm(true);');

    // Fix CrunzzoAdminDashboard logic
    content = content.replace(
      '    if (!window.confirm("Are you sure you want to logout?")) return;\\n',
      ''
    );

    // Fix BounceAdminDashboard logic
    const bounceSearch = \`                  if (window.confirm("Are you sure you want to logout?")) {
                    handleLogout();
                  }\`;
    content = content.replace(bounceSearch, '                  setShowLogoutConfirm(true);');

    // Fix standard handleLogout calls on buttons
    content = content.split('onClick={handleLogout}').join('onClick={() => setShowLogoutConfirm(true)}');

    // Insert modal JSX
    const pos = content.lastIndexOf('    </div>');
    if (pos !== -1) {
      content = content.slice(0, pos) + modalJsx + content.slice(pos);
    }
    
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Processed:', file);
  }
});
