package dev.projectflow.ops;

import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Work that must happen whether the current transaction commits or rolls back: recording a refused
 * attempt (the refusal itself rolls the transaction back), or retiring an invitation found to be
 * stale while refusing it. It runs once the transaction has finished, in a transaction of its own;
 * outside a transaction it runs at once.
 */
@Component
public class AfterTransaction {

    private final TransactionTemplate requiresNew;

    public AfterTransaction(PlatformTransactionManager transactions) {
        this.requiresNew = new TransactionTemplate(transactions);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public void runAfterCompletion(Runnable work) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            work.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                requiresNew.executeWithoutResult(s -> work.run());
            }
        });
    }
}
