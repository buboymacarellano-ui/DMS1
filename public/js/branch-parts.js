// Branch Parts "Approve All" handler for receiving transfers
document.addEventListener('DOMContentLoaded', () => {
  const receiveAllButtons = document.querySelectorAll('.branch-receive-all-btn');
  
  receiveAllButtons.forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault();
      
      const transactionNumber = btn.getAttribute('data-transaction-number');
      if (!transactionNumber) {
        window.alert('Transaction number not found.');
        return;
      }
      
      const ok = window.confirm(`Approve all transfers for transaction ${transactionNumber}?`);
      if (!ok) return;
      
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Processing...';
      
      try {
        const res = await fetch(`/branch-parts/api/receive-all/${encodeURIComponent(transactionNumber)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({}),
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          console.error('API error:', data);
          window.alert('Failed to receive transfers:\n\n' + (data.error || 'Unknown error'));
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }
        
        if (!data.ok) {
          console.error('Response indicates failure:', data);
          window.alert('Failed to receive transfers:\n\n' + (data.error || 'Unknown error'));
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }
        
        console.log('Receive-all success:', data);
        
        // Build success message with details
        const successMessage = `✓ Successfully received ${data.transfersReceived} transfer(s) for transaction ${transactionNumber}`;
        
        // Reload page with success message
        window.location.href = `/branch-parts?success=${encodeURIComponent(successMessage)}`;
      } catch (err) {
        console.error('Network error:', err);
        window.alert('Network error:\n\n' + err.message);
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  });
});
