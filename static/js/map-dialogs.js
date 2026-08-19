// Reusable, non-blocking dialogs for map actions. These replace browser alert()
// and confirm() calls, whose "do not show again" setting can disable workflows.
(function () {
    let activeDialog = null;

    function closeDialog(result) {
        if (!activeDialog) return;

        const dialog = activeDialog;
        activeDialog = null;
        document.removeEventListener('keydown', dialog.onKeyDown);
        dialog.overlay.remove();
        if (dialog.previousFocus && typeof dialog.previousFocus.focus === 'function') {
            dialog.previousFocus.focus();
        }
        dialog.resolve(result);
    }

    function openDialog(options) {
        if (activeDialog) closeDialog(false);

        return new Promise(function (resolve) {
            const isConfirmation = options.kind === 'confirm';
            const overlay = document.createElement('div');
            overlay.className = 'map-dialog-overlay';

            const dialog = document.createElement('section');
            dialog.className = 'map-dialog';
            dialog.setAttribute('role', isConfirmation ? 'dialog' : 'alertdialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', 'map-dialog-title');
            dialog.setAttribute('aria-describedby', 'map-dialog-message');

            const header = document.createElement('div');
            header.className = 'map-dialog__header';
            const title = document.createElement('h2');
            title.className = 'map-dialog__title';
            title.id = 'map-dialog-title';
            title.textContent = options.title || (isConfirmation ? 'Vahvista toiminto' : 'Ilmoitus');
            header.appendChild(title);

            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'map-dialog__close';
            closeButton.setAttribute('aria-label', 'Sulje');
            closeButton.textContent = '×';
            closeButton.addEventListener('click', function () { closeDialog(!isConfirmation); });
            header.appendChild(closeButton);

            const body = document.createElement('div');
            body.className = 'map-dialog__body';
            body.id = 'map-dialog-message';
            body.textContent = options.message;

            const actions = document.createElement('div');
            actions.className = 'map-dialog__actions';
            if (isConfirmation) {
                const cancelButton = document.createElement('button');
                cancelButton.type = 'button';
                cancelButton.className = 'map-dialog__button map-dialog__button--secondary';
                cancelButton.textContent = options.cancelLabel || 'Peruuta';
                cancelButton.addEventListener('click', function () { closeDialog(false); });
                actions.appendChild(cancelButton);
            }

            const confirmButton = document.createElement('button');
            confirmButton.type = 'button';
            confirmButton.className = 'map-dialog__button';
            confirmButton.textContent = options.confirmLabel || 'OK';
            confirmButton.addEventListener('click', function () { closeDialog(true); });
            actions.appendChild(confirmButton);

            dialog.appendChild(header);
            dialog.appendChild(body);
            dialog.appendChild(actions);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const onKeyDown = function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeDialog(!isConfirmation);
                }
            };
            activeDialog = { overlay, resolve, previousFocus: document.activeElement, onKeyDown };
            document.addEventListener('keydown', onKeyDown);
            confirmButton.focus();
        });
    }

    window.mapDialogs = {
        notify: function (message, options) {
            return openDialog(Object.assign({}, options, { kind: 'notify', message }));
        },
        confirm: function (message, options) {
            return openDialog(Object.assign({}, options, { kind: 'confirm', message }));
        }
    };
})();