(function() {
    'use strict';
    
    document.addEventListener('DOMContentLoaded', function() {
        const companySelect = document.getElementById('id_company');
        const individualSelect = document.getElementById('id_individual');
        
        if (!companySelect || !individualSelect) {
            return;
        }
        
        // Get the field containers
        const companyField = companySelect.closest('.form-group') || companySelect.closest('div');
        const individualField = individualSelect.closest('.form-group') || individualSelect.closest('div');
        
        // Function to update field states
        function updateFieldStates() {
            const hasCompany = companySelect.value && companySelect.value.trim() !== '';
            const hasIndividual = individualSelect.value && individualSelect.value.trim() !== '';
            
            // If company is selected, disable individual
            if (hasCompany) {
                individualSelect.disabled = true;
                individualSelect.value = '';
                if (individualField) {
                    individualField.style.opacity = '0.5';
                    individualField.style.pointerEvents = 'none';
                }
            } else {
                individualSelect.disabled = false;
                if (individualField) {
                    individualField.style.opacity = '1';
                    individualField.style.pointerEvents = 'auto';
                }
            }
            
            // If individual is selected, disable company
            if (hasIndividual) {
                companySelect.disabled = true;
                companySelect.value = '';
                if (companyField) {
                    companyField.style.opacity = '0.5';
                    companyField.style.pointerEvents = 'none';
                }
            } else {
                companySelect.disabled = false;
                if (companyField) {
                    companyField.style.opacity = '1';
                    companyField.style.pointerEvents = 'auto';
                }
            }
        }
        
        // Attach event listeners
        companySelect.addEventListener('change', updateFieldStates);
        individualSelect.addEventListener('change', updateFieldStates);
        
        // Initialize on page load
        updateFieldStates();
    });
})();
