import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../lib/store';
import { usePreferences } from '../../hooks/usePreferences';
import { invokeContractFunction } from '../../lib/contractInvoker';
import { simulateContractCall, isValidContractId } from '../../lib/stellar';
import { addContractInteraction, getContractInteractions } from '../../lib/storage';
import { generateId } from '../../lib/notifications';
import ContractHistory from './ContractHistory';

const ARGUMENT_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'int', label: 'Int' },
  { value: 'address', label: 'Address' },
  { value: 'bool', label: 'Bool' },
];

function Panel({ title, subtitle, children }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '13px',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: '4px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ padding: '18px' }}>{children}</div>
    </div>
  );
}

function LabeledField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function textInputStyle(hasError = false) {
  return {
    width: '100%',
    background: 'var(--bg-elevated)',
    border: `1px solid ${hasError ? 'var(--red)' : 'var(--border-bright)'}`,
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    transition: 'var(--transition)',
    boxSizing: 'border-box',
  };
}

function ActionButton({ label, onClick, disabled, tone = 'primary' }) {
  const palette =
    tone === 'secondary'
      ? {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-bright)',
        }
      : {
          background: 'var(--cyan)',
          color: 'var(--bg-base)',
          border: 'none',
        };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 16px',
        background: disabled ? 'var(--bg-elevated)' : palette.background,
        color: disabled ? 'var(--text-muted)' : palette.color,
        border: disabled ? '1px solid var(--border)' : palette.border,
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: '12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'var(--transition)',
      }}
    >
      {label}
    </button>
  );
}

function ResultBlock({ label, data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          overflowX: 'auto',
          lineHeight: 1.6,
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function ContractInteraction() {
  const { connectedAddress, network } = useStore();

  const [activeTab, setActiveTab] = useState('interact'); // "interact" | "history"

  const [form, setForm] = useState({
    contractId: '',
    functionName: '',
    sourceAccount: connectedAddress || '',
    secretKey: '',
    args: [{ type: 'string', value: '' }],
  });

  const [simulateLoading, setSimulateLoading] = useState(false);
  const [invokeLoading, setInvokeLoading] = useState(false);
  const [error, setError] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);
  const [invokeResult, setInvokeResult] = useState(null);

  const { preferences, update } = usePreferences();
  const advancedPreferences = preferences?.advanced || {};
  const assistantEnabled = advancedPreferences.enableContractAssistant ?? true;

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isMainnet = network === 'mainnet';
  const contractIdError =
    form.contractId.trim() !== '' && !isValidContractId(form.contractId.trim());

  useEffect(() => {
    let active = true;
    async function loadHistory() {
      setHistoryLoading(true);
      try {
        const items = await getContractInteractions();
        if (active) setHistory(items);
      } finally {
        if (active) setHistoryLoading(false);
      }
    }

    if (assistantEnabled) {
      loadHistory();
    }

    return () => {
      active = false;
    };
  }, [assistantEnabled]);

  const matchingHistory = useMemo(() => {
    if (!form.contractId.trim() || !form.functionName.trim()) {
      return [];
    }

    return history.filter(
      (record) =>
        record.contractId === form.contractId.trim() &&
        record.functionName === form.functionName.trim() &&
        record.status === 'success'
    );
  }, [form.contractId, form.functionName, history]);

  const lastSuccessfulCallHint = useMemo(() => {
    if (matchingHistory.length === 0) return null;

    const latest = matchingHistory[0];
    if (!latest.args || latest.args.length === 0) return null;

    const values = latest.args.map((arg) => `${arg.type}:${arg.value}`).join(', ');

    return `Last successful call used ${values}. Use these values as a starting point or review History for details.`;
  }, [matchingHistory]);

  const argumentIssues = useMemo(() => {
    return form.args.map((arg) => {
      const value = arg.value.trim();
      if (!value) return null;
      if (arg.type === 'int' && !/^-?\d+$/.test(value)) {
        return 'This argument expects an integer value. Use only digits and optional leading - for negatives.';
      }
      if (arg.type === 'bool' && !/^(true|false)$/i.test(value)) {
        return 'This argument expects a boolean value of true or false.';
      }
      if (arg.type === 'address' && !/^G[A-Z2-7]{55}$/.test(value)) {
        return 'This argument expects a valid Stellar account address starting with G.';
      }
      return null;
    });
  }, [form.args]);

  const assistantMessages = useMemo(() => {
    if (!assistantEnabled) return [];

    const messages = [];
    if (!form.contractId.trim()) {
      messages.push({
        tone: 'info',
        text: 'Enter a Soroban contract ID to begin. This is required for simulation and invocation.',
      });
    } else if (contractIdError) {
      messages.push({
        tone: 'warning',
        text: 'The contract ID looks invalid. Confirm the address and try again.',
      });
    }

    if (!form.functionName.trim()) {
      messages.push({
        tone: 'info',
        text: 'Specify the contract function you want to call, such as initialize, transfer, or submit_price.',
      });
    }

    const missingArgs = form.args.filter((arg) => arg.value.trim() === '');
    if (missingArgs.length > 0) {
      messages.push({
        tone: 'info',
        text: `Fill in values for all argument entries. ${missingArgs.length} argument(s) are still blank.`,
      });
    }

    const issueMessages = argumentIssues.filter(Boolean);
    if (issueMessages.length > 0) {
      issueMessages.forEach((issue) => {
        messages.push({ tone: 'warning', text: issue });
      });
    }

    if (!form.sourceAccount.trim() && connectedAddress) {
      messages.push({
        tone: 'info',
        text: 'Your connected address can be used as the source account if left blank.',
      });
    }

    if (!isMainnet && !form.secretKey.trim()) {
      messages.push({
        tone: 'info',
        text: 'Provide a testnet secret key only when you are ready to invoke a transaction. Use simulation first.',
      });
    }

    if (form.args.some((arg) => arg.type === 'bool' && !arg.value.trim())) {
      messages.push({ tone: 'info', text: 'Use true or false for bool arguments.' });
    }
    if (form.args.some((arg) => arg.type === 'address' && !arg.value.trim())) {
      messages.push({
        tone: 'info',
        text: 'Use a valid Stellar account address starting with G for address arguments.',
      });
    }
    if (form.args.some((arg) => arg.type === 'int' && !arg.value.trim())) {
      messages.push({
        tone: 'info',
        text: 'Type numeric values for int arguments, for example 1 or 42.',
      });
    }

    if (lastSuccessfulCallHint) {
      messages.push({ tone: 'success', text: lastSuccessfulCallHint });
    }

    if (messages.length === 0) {
      messages.push({
        tone: 'success',
        text: 'Looks good. Run a simulation to verify the contract call before submitting.',
      });
    }

    return messages.slice(0, 5);
  }, [assistantEnabled, form, contractIdError, argumentIssues, connectedAddress, isMainnet]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateArgument(index, field, value) {
    setForm((current) => ({
      ...current,
      args: current.args.map((arg, i) => (i === index ? { ...arg, [field]: value } : arg)),
    }));
  }

  function addArgument() {
    setForm((current) => ({
      ...current,
      args: [...current.args, { type: 'string', value: '' }],
    }));
  }

  function removeArgument(index) {
    setForm((current) => ({
      ...current,
      args: current.args.filter((_, i) => i !== index),
    }));
  }

  async function recordInteraction(type, status, result, errorMsg) {
    await addContractInteraction({
      id: generateId(),
      timestamp: Date.now(),
      network,
      type,
      contractId: form.contractId,
      functionName: form.functionName,
      args: form.args.filter((arg) => arg.value.trim() !== ''),
      sourceAccount: form.sourceAccount || connectedAddress,
      status,
      result,
      error: errorMsg,
    });
  }

  async function handleSimulate() {
    setError('');
    setInvokeResult(null);
    setSimulationResult(null);
    setSimulateLoading(true);

    try {
      const result = await simulateContractCall({
        contractId: form.contractId,
        functionName: form.functionName,
        args: form.args.filter((arg) => arg.value.trim() !== ''),
        sourceAccount: form.sourceAccount || connectedAddress,
        network,
      });
      setSimulationResult(result);
      await recordInteraction('simulate', 'success', result, null);
    } catch (err) {
      setError(err.message || 'Simulation failed');
      await recordInteraction('simulate', 'error', null, err.message || 'Simulation failed');
    } finally {
      setSimulateLoading(false);
    }
  }

  async function handleInvoke() {
    setError('');
    setInvokeResult(null);
    setInvokeLoading(true);

    try {
      const result = await invokeContractFunction({
        contractId: form.contractId,
        functionName: form.functionName,
        args: form.args.filter((arg) => arg.value.trim() !== ''),
        sourceAccount: form.sourceAccount || connectedAddress,
        secretKey: form.secretKey,
        network,
      });
      setInvokeResult(result);
      await recordInteraction('invoke', 'success', result, null);
    } catch (err) {
      setError(err.message || 'Invocation failed');
      await recordInteraction('invoke', 'error', null, err.message || 'Invocation failed');
    } finally {
      setInvokeLoading(false);
    }
  }

  function handleReplay(record) {
    setForm({
      contractId: record.contractId,
      functionName: record.functionName,
      sourceAccount: record.sourceAccount,
      secretKey: '',
      args: record.args && record.args.length > 0 ? record.args : [{ type: 'string', value: '' }],
    });
    setSimulationResult(null);
    setInvokeResult(null);
    setError('');
    setActiveTab('interact');
  }

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '16px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '22px',
            fontWeight: 700,
          }}
        >
          Contract Interaction
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <ActionButton
            label="Interact"
            onClick={() => setActiveTab('interact')}
            tone={activeTab === 'interact' ? 'primary' : 'secondary'}
          />
          <ActionButton
            label="History"
            onClick={() => setActiveTab('history')}
            tone={activeTab === 'history' ? 'primary' : 'secondary'}
          />
        </div>
      </div>

      {activeTab === 'history' ? (
        <ContractHistory onReplay={handleReplay} />
      ) : (
        <>
          <Panel
            title="Contract Call Configuration"
            subtitle="Configure and execute Soroban contract functions"
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '14px',
                marginBottom: '18px',
              }}
            >
              <LabeledField label="Contract ID">
                <input
                  value={form.contractId}
                  onChange={(e) => updateField('contractId', e.target.value)}
                  placeholder="C... contract address"
                  style={textInputStyle(contractIdError)}
                />
              </LabeledField>

              <LabeledField label="Function Name">
                <input
                  value={form.functionName}
                  onChange={(e) => updateField('functionName', e.target.value)}
                  placeholder="increment"
                  style={textInputStyle()}
                />
              </LabeledField>

              <LabeledField label="Source Account">
                <input
                  value={form.sourceAccount}
                  onChange={(e) => updateField('sourceAccount', e.target.value)}
                  placeholder={connectedAddress || 'G... source account'}
                  style={textInputStyle()}
                />
              </LabeledField>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                }}
              >
                Function Arguments
              </div>
              <ActionButton label="Add Argument" onClick={addArgument} tone="secondary" />
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                marginBottom: '18px',
              }}
            >
              {form.args.map((arg, index) => (
                <div
                  key={index}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr auto',
                    gap: '10px',
                    alignItems: 'center',
                  }}
                >
                  <select
                    value={arg.type}
                    onChange={(e) => updateArgument(index, 'type', e.target.value)}
                    style={textInputStyle()}
                  >
                    {ARGUMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>

                  <input
                    value={arg.value}
                    onChange={(e) => updateArgument(index, 'value', e.target.value)}
                    placeholder={arg.type === 'bool' ? 'true or false' : 'Argument value'}
                    style={textInputStyle()}
                  />

                  <ActionButton
                    label="Remove"
                    onClick={() => removeArgument(index)}
                    disabled={form.args.length === 1}
                    tone="secondary"
                  />
                </div>
              ))}
            </div>

            <div
              style={{
                marginBottom: '18px',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${isMainnet ? 'var(--amber)' : 'var(--border)'}`,
                background: isMainnet ? 'rgba(255, 184, 0, 0.08)' : 'var(--bg-elevated)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: isMainnet ? 'var(--amber)' : 'var(--text-secondary)',
                  lineHeight: 1.6,
                }}
              >
                {isMainnet
                  ? 'Mainnet mode: Simulation available, but transaction submission is disabled for safety.'
                  : 'Testnet mode: Full simulation and submission available.'}
              </div>

              <LabeledField label="Secret Key (for submission)">
                <input
                  type="password"
                  value={form.secretKey}
                  onChange={(e) => updateField('secretKey', e.target.value)}
                  placeholder="S... testnet secret key"
                  style={textInputStyle()}
                />
              </LabeledField>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionButton
                label={simulateLoading ? 'Simulating...' : 'Simulate'}
                onClick={handleSimulate}
                disabled={simulateLoading || invokeLoading}
              />
              <ActionButton
                label={invokeLoading ? 'Invoking...' : 'Invoke'}
                onClick={handleInvoke}
                disabled={isMainnet || invokeLoading || simulateLoading}
                tone="secondary"
              />
            </div>

            {error && (
              <div
                style={{
                  marginTop: '14px',
                  fontSize: '12px',
                  color: 'var(--red)',
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </Panel>

          {assistantEnabled ? (
            <Panel
              title="AI Contract Assistant"
              subtitle="Real-time suggestions and validation help for your current contract call."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {assistantMessages.map((message, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      background:
                        message.tone === 'warning'
                          ? 'rgba(255, 87, 87, 0.08)'
                          : message.tone === 'success'
                            ? 'rgba(34, 197, 94, 0.08)'
                            : 'rgba(34, 211, 238, 0.08)',
                      border:
                        message.tone === 'warning'
                          ? '1px solid rgba(255, 87, 87, 0.2)'
                          : message.tone === 'success'
                            ? '1px solid rgba(34, 197, 94, 0.2)'
                            : '1px solid rgba(34, 211, 238, 0.2)',
                      color:
                        message.tone === 'warning'
                          ? 'var(--red)'
                          : message.tone === 'success'
                            ? 'var(--green)'
                            : 'var(--text-primary)',
                      fontSize: '12px',
                      lineHeight: 1.5,
                    }}
                  >
                    {message.text}
                  </div>
                ))}
                <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() =>
                      update('advanced', {
                        ...advancedPreferences,
                        enableContractAssistant: false,
                      })
                    }
                    style={{
                      padding: '8px 12px',
                      background: 'transparent',
                      border: '1px solid var(--border-bright)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-secondary)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Disable Assistant
                  </button>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel
              title="AI Contract Assistant"
              subtitle="The contract assistant is disabled in preferences."
            >
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                You can re-enable the assistant under Settings &gt; General &gt; Contract Assistant.
              </div>
            </Panel>
          )}

          {simulationResult && (
            <div style={{ display: 'grid', gap: '16px' }}>
              <ResultBlock label="Simulation Result" data={simulationResult.result} />
              <ResultBlock label="Events" data={simulationResult.events} />
            </div>
          )}

          {invokeResult && <ResultBlock label="Invocation Result" data={invokeResult} />}
        </>
      )}
    </div>
  );
}
